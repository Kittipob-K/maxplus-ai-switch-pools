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
 * Pick omp's wire api for a model. CLI Hop exposes these models through
 * OpenAI Chat Completions, which omp calls `openai-completions`.
 */
export function ompApiFor(model: RemoteModel): string {
  const apis = model.apis ?? [];
  return "openai-completions";
}

/**
 * Keeps the user's existing models.yml (other providers, comments aside)
 * always show the live CLI Hop catalogue through the Chat Completions wire.
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
    const chatModels = input.models.filter(
      (model) => !model.apis?.length || model.apis.includes("chat_completions")
    );
    const selected = chatModels.find((model) => model.id === input.selected);
    const catalogue: RemoteModel[] = selected
      ? [selected, ...chatModels.filter((model) => model.id !== selected.id)]
      : chatModels;

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
