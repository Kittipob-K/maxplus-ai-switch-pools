import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RemoteModel } from "../types.js";
import { stripJsonComments } from "./jsonc.js";
import { writeSecureFile } from "./secure-file.js";

/** Provider id written into Pi's models.json; also Pi's --model prefix. */
export const PI_PROVIDER_ID = "maxplus";

/**
 * The environment variable reference stored in Pi's models.json. The secret
 * is supplied only in the child environment from maxplus-ai Settings.
 */
export const PI_API_KEY_ENV = "MAXPLUS_API_KEY";

export interface PiModelsInput {
  /** Endpoint root WITHOUT /v1, e.g. https://api.maxplus-ai.cc */
  endpoint: string;
  /** Full catalogue to write (all pools from the MaxPlus API). */
  models: RemoteModel[];
  /** Selected model id; written first in the models list. */
  selected: string;
}

/** Resolve the Pi wire API for a MaxPlus model from its advertised capabilities. */
export function piApiFor(model: RemoteModel): string {
  const apis = model.apis ?? [];
  if (apis.includes("messages")) return "anthropic-messages";
  if (apis.includes("chat_completions")) return "openai-completions";
  if (apis.includes("responses")) return "openai-responses";
  return "anthropic-messages";
}

/**
 * Keeps the user's existing Pi providers and replaces only providers.maxplus
 * so Pi's /model picker always reflects the selected MaxPlus catalogue.
 */
export class PiConfigService {
  readonly modelsPath: string;

  constructor(modelsPath?: string) {
    this.modelsPath = modelsPath ?? join(homedir(), ".pi", "agent", "models.json");
  }

  /**
   * Read-merge-write models.json. Returns the path written. Refuses to
   * overwrite an existing file that cannot be parsed as a JSON object.
   */
  async apply(input: PiModelsInput): Promise<string> {
    let doc: Record<string, unknown> = {};
    try {
      const raw = await readFile(this.modelsPath, "utf8");
      const parsed: unknown = JSON.parse(stripJsonComments(raw));
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("models.json root must be an object");
      }
      doc = parsed as Record<string, unknown>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(
          `${this.modelsPath} exists but is not valid JSON - fix it manually before switching pools`
        );
      }
    }

    const currentProviders = doc.providers;
    if (
      currentProviders !== undefined &&
      (currentProviders === null ||
        typeof currentProviders !== "object" ||
        Array.isArray(currentProviders))
    ) {
      throw new Error(
        `${this.modelsPath} has an invalid providers object - fix it manually before switching pools`
      );
    }
    const providers = {
      ...(currentProviders as Record<string, unknown> | undefined),
    };
    const selected = input.models.find((model) => model.id === input.selected);
    const catalogue = selected
      ? [selected, ...input.models.filter((model) => model.id !== selected.id)]
      : [...input.models, { id: input.selected }];

    providers[PI_PROVIDER_ID] = {
      baseUrl: `${input.endpoint.replace(/\/+$/, "")}/v1`,
      apiKey: `$${PI_API_KEY_ENV}`,
      authHeader: true,
      models: catalogue.map((model) => ({
        id: model.id,
        name: model.displayName ?? model.id,
        api: piApiFor(model),
      })),
    };
    doc = { ...doc, providers };

    await writeSecureFile(
      this.modelsPath,
      `${JSON.stringify(doc, null, 2)}\n`
    );
    return this.modelsPath;
  }
}
