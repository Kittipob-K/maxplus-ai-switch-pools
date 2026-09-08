import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { RemoteModel } from "../types.js";
import { writeSecureFile } from "./secure-file.js";

/** Provider id written into models.yml; also omp's --model prefix. */
export const OMP_PROVIDER_ID = "cli-hop";

/**
 * Env var NAME stored as the provider's apiKey in models.yml. omp resolves
 * `apiKey` values first as an env var, so the secret stays in the child
 * process environment (exported from Settings) and never on disk.
 */
export const OMP_API_KEY_ENV = "CLI_HOP_API_KEY";

export interface OmpModelsInput {
  /** Endpoint root WITHOUT /v1, e.g. https://api.cli-hop.cc */
  endpoint: string;
  /** Full catalogue to write (all pools from the CLI Hop API). */
  models: RemoteModel[];
  /** Selected model id; written first in the models list. */
  selected: string;
}

/**
 * Pick omp's wire api for a model: anthropic-messages when the gateway
 * serves it on /v1/messages, otherwise whatever protocol it does support.
 */
export function ompApiFor(model: RemoteModel): string {
  const apis = model.apis ?? [];
  if (apis.includes("messages")) return "anthropic-messages";
  if (apis.includes("chat_completions")) return "openai-completions";
  if (apis.includes("responses")) return "openai-responses";
  if (apis.includes("generateContent") || apis.includes("streamGenerateContent")) {
    return "google-generative-ai";
  }
  // Gateways that omit capability metadata commonly expose GPT/Codex models
  // on the OpenAI responses channel. Avoid sending these through Anthropic.
  if (/^(gpt|o[1-9]|codex)/i.test(model.id)) return "openai-responses";
  if (/^gemini/i.test(model.id)) return "google-generative-ai";
  // No capability info (older gateway / local pools) - catalogue is
  // Claude-family, and this is what the env-var path always assumed.
  return "anthropic-messages";
}

/**
 * Keeps the user's existing models.yml (other providers, comments aside)
 * and replaces only our `providers.cli-hop` block so `omp` / `/model`
 * always show the live CLI Hop catalogue with the correct wire per model.
 */
export class OmpConfigService {
  readonly modelsPath: string;

  constructor(modelsPath?: string) {
    this.modelsPath = modelsPath ?? join(homedir(), ".omp", "agent", "models.yml");
  }

  /**
   * Read-merge-write models.yml. Returns the path written.
   * Throws if an existing file fails to parse - we refuse to clobber it.
   */
  async apply(input: OmpModelsInput): Promise<string> {
    let doc: Record<string, unknown> = {};
    try {
      const raw = await readFile(this.modelsPath, "utf8");
      const parsed = parse(raw);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("models.yml root must be an object");
      }
      doc = parsed as Record<string, unknown>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(
          `${this.modelsPath} exists but is not valid YAML - fix it manually before switching pools`
        );
      }
    }

    const currentProviders = doc.providers;
    if (currentProviders !== undefined && (
      !currentProviders ||
      typeof currentProviders !== "object" ||
      Array.isArray(currentProviders)
    )) {
      throw new Error(`${this.modelsPath} has an invalid providers object`);
    }
    const providers = {
      ...(currentProviders as Record<string, unknown> | undefined),
    };
    const selected = input.models.find((m) => m.id === input.selected);
    // Selected model first, then the rest of the live catalogue.
    const catalogue = selected
      ? [selected, ...input.models.filter((m) => m.id !== selected.id)]
      : [...input.models, { id: input.selected }];

    providers[OMP_PROVIDER_ID] = {
      baseUrl: `${input.endpoint.replace(/\/+$/, "")}/v1`,
      apiKey: OMP_API_KEY_ENV,
      // CLI Hop speaks Bearer auth on both wires (like the /models API).
      authHeader: true,
      // Anthropic-fronted proxies commonly reject the `strict` tool field.
      disableStrictTools: true,
      models: catalogue.map((m) => ({
        id: m.id,
        name: m.displayName ?? m.id,
        api: ompApiFor(m),
      })),
    };
    doc = { ...doc, providers };

    await writeSecureFile(this.modelsPath, stringify(doc));
    return this.modelsPath;
  }
}
