import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RemoteModel } from "../types.js";
import { stripJsonComments } from "./jsonc.js";
import { writeSecureFile } from "./secure-file.js";

const OPEN_CODE_SCHEMA_URL = "https://opencode.ai/config.json";
const OPEN_CODE_PROVIDER_ID = "maxplus";
const FIX_HINT = " - fix it manually before switching pools";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export interface OpenCodeConfigInput {
  endpoint: string;
  models: RemoteModel[];
  selected: string;
}

export interface OpenCodeConfigResult {
  /** Path of the opencode.json file written. */
  path: string;
  /**
   * Model ids kept from a previous write because the live MaxPlus catalogue no
   * longer lists them. Opencode still offers them and requests against them
   * fail, so callers should surface these to the user. Empty when the
   * catalogue was not live (models API unreachable), since then absence is not
   * evidence.
   */
  staleModels: string[];
}

/**
 * Merge-writes provider.maxplus in opencode.json, keeping the user's other
 * providers, extra options and hand-tuned model entries. Only the live MaxPlus
 * catalogue and baseURL/apiKey are replaced, so a gateway rename never erases a
 * limit the user set by hand.
 */
export class OpenCodeConfigService {
  readonly configPath: string;

  constructor(configPath?: string) {
    const configBase = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
    this.configPath = configPath ?? join(configBase, "opencode", "opencode.json");
  }

  async apply(input: OpenCodeConfigInput): Promise<OpenCodeConfigResult> {
    let document: Record<string, unknown> = {};
    let existed = false;
    try {
      const parsed: unknown = JSON.parse(stripJsonComments(await readFile(this.configPath, "utf8")));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("config root must be an object");
      }
      document = parsed as Record<string, unknown>;
      existed = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`${this.configPath} is not valid JSON/JSONC${FIX_HINT}`);
      }
    }

    const existingProviders = document.provider;
    if (existingProviders !== undefined && !isRecord(existingProviders)) {
      throw new Error(`${this.configPath} has an invalid provider object${FIX_HINT}`);
    }

    // Opencode uses only the OpenAI-compatible wire. When the gateway advertises
    // no capabilities (older API, or a locally configured pool) keep the
    // selected model so the user can still launch it.
    const compatibleModels = input.models.filter((model) =>
      model.apis?.includes("chat_completions") ?? model.id === input.selected
    );
    const selected = compatibleModels.find((model) => model.id === input.selected);
    // Selected model first, then the rest of the live catalogue.
    const catalogue = selected
      ? [selected, ...compatibleModels.filter((model) => model.id !== selected.id)]
      : compatibleModels;

    const providers = { ...(existingProviders ?? {}) };
    const existingMaxPlus = providers[OPEN_CODE_PROVIDER_ID];
    if (existingMaxPlus !== undefined && !isRecord(existingMaxPlus)) {
      throw new Error(`${this.configPath} has an invalid maxplus provider object${FIX_HINT}`);
    }

    const maxplus = existingMaxPlus ?? {};
    const existingOptions = maxplus.options;
    if (existingOptions !== undefined && !isRecord(existingOptions)) {
      throw new Error(`${this.configPath} has an invalid maxplus options object${FIX_HINT}`);
    }

    const existingModels = maxplus.models;
    if (existingModels !== undefined && !isRecord(existingModels)) {
      throw new Error(`${this.configPath} has an invalid maxplus models object${FIX_HINT}`);
    }

    const mergedModels: Record<string, unknown> = {};
    for (const model of catalogue) {
      const existingModel = existingModels?.[model.id];
      if (existingModel !== undefined && !isRecord(existingModel)) {
        throw new Error(
          `${this.configPath} has an invalid maxplus model configuration for ${model.id}${FIX_HINT}`
        );
      }
      const gatewayName = model.displayName?.trim();
      mergedModels[model.id] = {
        ...(existingModel ?? {}),
        // displayName wins so a gateway rename is picked up on the next sync;
        // the saved name only stands in for a model the gateway does not label.
        name:
          gatewayName ||
          (typeof existingModel?.name === "string" ? existingModel.name : model.id),
      };
    }

    // Only a live catalogue proves a model is gone: without wire capabilities
    // maxplus-ai fell back to its built-in pools (or the gateway advertised
    // none), so an absent id is not evidence of retirement. A model present but
    // filtered out by the chat_completions filter is still served by the
    // gateway - opencode just cannot reach it on that wire.
    const catalogueKnown = input.models.some((model) => model.apis?.length);
    const knownIds = new Set(input.models.map((model) => model.id));

    const staleModels: string[] = [];
    for (const [modelId, modelConfig] of Object.entries(existingModels ?? {})) {
      if (Object.hasOwn(mergedModels, modelId)) continue;
      // Kept so a gateway rename never drops a configuration the user set up by
      // hand. Entries this CLI did not write (null, a string, ...) pass through
      // untouched: only ids it writes itself are shape-checked above.
      mergedModels[modelId] = modelConfig;
      if (catalogueKnown && !knownIds.has(modelId)) staleModels.push(modelId);
    }

    providers[OPEN_CODE_PROVIDER_ID] = {
      ...maxplus,
      npm: "@ai-sdk/openai-compatible",
      name: "MaxPlus",
      options: {
        ...(existingOptions ?? {}),
        baseURL: `${input.endpoint.replace(/\/+$/, "")}/v1`,
        apiKey: "{env:MAXPLUS_API_KEY}",
      },
      models: mergedModels,
    };

    const output: Record<string, unknown> = { ...document, provider: providers };
    // Opencode's schema sets additionalProperties: false on Config and
    // ProviderConfig, so injecting $schema into a pre-existing file would make
    // the editor flag the user's own unrelated keys. Only seed it for a file we
    // create from scratch.
    if (!existed) output.$schema = OPEN_CODE_SCHEMA_URL;

    await writeSecureFile(
      this.configPath,
      `${JSON.stringify(output, null, 2)}\n`
    );
    return { path: this.configPath, staleModels };
  }
}
