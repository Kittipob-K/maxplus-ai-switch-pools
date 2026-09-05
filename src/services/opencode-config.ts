import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RemoteModel } from "../types.js";
import { stripJsonComments } from "./jsonc.js";
import { writeSecureFile } from "./secure-file.js";

const OPEN_CODE_SCHEMA_URL = "https://opencode.ai/config.json";
const OPEN_CODE_PROVIDER_ID = "maxplus";

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
   * Model ids kept from a previous write because they are no longer in the
   * MaxPlus catalogue. Opencode will still offer them and requests against
   * them will fail, so callers should surface these to the user.
   */
  staleModels: string[];
}

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
        throw new Error(
          `${this.configPath} is not valid JSON/JSONC - fix it manually before switching pools`
        );
      }
    }

    const existingProviders = document.provider;
    if (existingProviders !== undefined && !isRecord(existingProviders)) {
      throw new Error(
        `${this.configPath} has an invalid provider object - fix it manually before switching pools`
      );
    }

    const compatibleModels = input.models.filter((model) =>
      model.apis?.includes("chat_completions") ?? model.id === input.selected
    );
    const selected = compatibleModels.find((model) => model.id === input.selected);
    const catalogue = selected
      ? [selected, ...compatibleModels.filter((model) => model.id !== selected.id)]
      : compatibleModels;

    const providers = { ...(existingProviders ?? {}) };
    const existingMaxPlus = providers[OPEN_CODE_PROVIDER_ID];
    if (existingMaxPlus !== undefined && !isRecord(existingMaxPlus)) {
      throw new Error(
        `${this.configPath} has an invalid maxplus provider object - fix it manually before switching pools`
      );
    }

    const maxplus = existingMaxPlus ?? {};
    const existingOptions = maxplus.options;
    if (existingOptions !== undefined && !isRecord(existingOptions)) {
      throw new Error(
        `${this.configPath} has an invalid maxplus options object - fix it manually before switching pools`
      );
    }

    const existingModels = maxplus.models;
    if (existingModels !== undefined && !isRecord(existingModels)) {
      throw new Error(
        `${this.configPath} has an invalid maxplus models object - fix it manually before switching pools`
      );
    }

    const mergedModels: Record<string, unknown> = {};
    for (const model of catalogue) {
      const existingModel = existingModels?.[model.id];
      if (existingModel !== undefined && !isRecord(existingModel)) {
        throw new Error(
          `${this.configPath} has an invalid maxplus model configuration for ${model.id} ` +
            "- fix it manually before switching pools"
        );
      }
      mergedModels[model.id] = {
        ...(existingModel ?? {}),
        name:
          model.displayName ??
          (typeof existingModel?.name === "string" ? existingModel.name : model.id),
      };
    }
    const staleModels: string[] = [];
    for (const [modelId, modelConfig] of Object.entries(existingModels ?? {})) {
      if (Object.hasOwn(mergedModels, modelId)) continue;
      // Preserve models the gateway no longer serves so a renamed/removed pool
      // never drops a configuration the user set up by hand; staleModels
      // surfaces them to the caller instead of keeping them silently.
      staleModels.push(modelId);
      mergedModels[modelId] = modelConfig;
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
