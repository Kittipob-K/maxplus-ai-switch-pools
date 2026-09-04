import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RemoteModel } from "../types.js";
import { stripJsonComments } from "./jsonc.js";
import { writeSecureFile } from "./secure-file.js";

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
    if (existingProviders !== undefined && (!existingProviders || typeof existingProviders !== "object" || Array.isArray(existingProviders))) {
      throw new Error(`${this.configPath} has an invalid provider object`);
    }

    const compatibleModels = input.models.filter((model) =>
      model.apis?.includes("chat_completions") ?? model.id === input.selected
    );
    const selected = compatibleModels.find((model) => model.id === input.selected);
    const catalogue = selected
      ? [selected, ...compatibleModels.filter((model) => model.id !== selected.id)]
      : compatibleModels;

    const providers = { ...(existingProviders as Record<string, unknown> | undefined) };
    providers.maxplus = {
      npm: "@ai-sdk/openai-compatible",
      name: "MaxPlus",
      options: {
        baseURL: `${input.endpoint.replace(/\/+$/, "")}/v1`,
        apiKey: "{env:MAXPLUS_API_KEY}",
      },
      models: Object.fromEntries(
        catalogue.map((model) => [model.id, { name: model.displayName ?? model.id }])
      ),
    };

    await writeSecureFile(
      this.configPath,
      `${JSON.stringify({ ...document, provider: providers }, null, 2)}\n`
    );
    return this.configPath;
  }
}
