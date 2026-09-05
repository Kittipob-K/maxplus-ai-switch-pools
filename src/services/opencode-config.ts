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

export class OpenCodeConfigService {
  readonly configPath: string;

  constructor(configPath?: string) {
    const configBase = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
    this.configPath = configPath ?? join(configBase, "opencode", "opencode.json");
  }

  async apply(input: OpenCodeConfigInput): Promise<string> {
    let document: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(stripJsonComments(await readFile(this.configPath, "utf8")));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("config root must be an object");
      }
      document = parsed as Record<string, unknown>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`${this.configPath} is not valid JSON/JSONC - fix it before switching pools`);
      }
    }

    const existingProviders = document.provider;
    if (existingProviders !== undefined && !isRecord(existingProviders)) {
      throw new Error(`${this.configPath} has an invalid provider object`);
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
      throw new Error(`${this.configPath} has an invalid maxplus provider object`);
    }

    const maxplus = existingMaxPlus ?? {};
    const existingOptions = maxplus.options;
    if (existingOptions !== undefined && !isRecord(existingOptions)) {
      throw new Error(`${this.configPath} has an invalid maxplus options object`);
    }

    const existingModels = maxplus.models;
    if (existingModels !== undefined && !isRecord(existingModels)) {
      throw new Error(`${this.configPath} has an invalid maxplus models object`);
    }

    const mergedModels: Record<string, unknown> = {};
    for (const model of catalogue) {
      const existingModel = existingModels?.[model.id];
      if (existingModel !== undefined && !isRecord(existingModel)) {
        throw new Error(
          `${this.configPath} has an invalid maxplus model configuration for ${model.id}`
        );
      }
      mergedModels[model.id] = {
        ...(existingModel ?? {}),
        name:
          model.displayName ??
          (typeof existingModel?.name === "string" ? existingModel.name : model.id),
      };
    }
    for (const [modelId, modelConfig] of Object.entries(existingModels ?? {})) {
      if (!Object.hasOwn(mergedModels, modelId)) mergedModels[modelId] = modelConfig;
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
    if (typeof output.$schema !== "string") output.$schema = OPEN_CODE_SCHEMA_URL;

    await writeSecureFile(
      this.configPath,
      `${JSON.stringify(output, null, 2)}\n`
    );
    return this.configPath;
  }
}
