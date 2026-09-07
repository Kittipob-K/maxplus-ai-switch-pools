import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RemoteModel } from "../types.js";
import { stripJsonComments } from "./jsonc.js";
import { writeSecureFile } from "./secure-file.js";
const OPEN_CODE_SCHEMA_URL = "https://opencode.ai/config.json";
const OPEN_CODE_PROVIDER_ID = "cli-hop";
const OPEN_CODE_OPENAI_PROVIDER_ID = "cli-hop-openai";
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
   * Model ids kept from a previous write because the live CLI Hop catalogue no
   * longer lists them. Opencode still offers them and requests against them
   * fail, so callers should surface these to the user. Empty when the
   * catalogue was not live (models API unreachable), since then absence is not
   * evidence.
   */
  staleModels: string[];
}

/**
 * Which provider id + wire the selected model is reachable on (installer
 * parity with opencode-install.sh: Claude-shaped pools go through
 * @ai-sdk/anthropic, OpenAI-compatible pools through @ai-sdk/openai-compatible).
 */
function providerRefFor(
  apis: string[] | undefined
): { provider: string; known: boolean } {
  if (apis?.includes("messages")) return { provider: OPEN_CODE_PROVIDER_ID, known: true };
  if (apis?.includes("chat_completions")) {
    return { provider: OPEN_CODE_OPENAI_PROVIDER_ID, known: true };
  }
  // Unknown protocol: prefer the Anthropic-shaped provider (Claude default).
  return { provider: OPEN_CODE_PROVIDER_ID, known: false };
}

/**
 * Merge-writes provider.cli-hop in opencode.json, keeping the user's other
 * providers, extra options and hand-tuned model entries. Only the live CLI Hop
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

    // Installer parity (opencode-install.sh): models are grouped by wire —
    // messages-capable ids go through an @ai-sdk/anthropic-shaped provider,
    // chat_completions ids through @ai-sdk/openai-compatible. Models without
    // advertised capabilities (older API, or a locally configured pool) stay
    // in the Anthropic-shaped provider so the selected model can still launch.
    const messagesModels = input.models.filter(
      (model) => model.apis?.includes("messages") || !model.apis?.length
    );
    const chatModels = input.models.filter((model) => model.apis?.includes("chat_completions"));
    const selected = input.models.find((model) => model.id === input.selected);
    // Selected model first, then the rest of the live catalogue.
    const withSelectedFirst = (models: RemoteModel[]): RemoteModel[] => {
      const head = models.filter((model) => model.id === input.selected);
      return head.length > 0
        ? [...head, ...models.filter((model) => model.id !== input.selected)]
        : models;
    };
    const anthropicCatalogue = withSelectedFirst(messagesModels);
    const openaiCatalogue = withSelectedFirst(chatModels);

    const providers = { ...(existingProviders ?? {}) };
    const existingProvidersById: Record<string, Record<string, unknown>> = {};
    for (const providerId of [OPEN_CODE_PROVIDER_ID, OPEN_CODE_OPENAI_PROVIDER_ID]) {
      const existing = providers[providerId];
      if (existing !== undefined && !isRecord(existing)) {
        throw new Error(`${this.configPath} has an invalid ${providerId} provider object${FIX_HINT}`);
      }
      existingProvidersById[providerId] = existing ?? {};
    }

    // Migration: releases before the dual-wire split wrote chat_completions
    // models into the single `cli-hop` provider. Entries the live catalogue
    // now advertises as chat-capable move to the OpenAI-compatible provider
    // (keeping their saved names/limits) instead of lingering on the
    // Anthropic wire.
    const legacyClihopModels = existingProvidersById[OPEN_CODE_PROVIDER_ID].models;
    const chatIds = new Set(chatModels.map((model) => model.id));
    const anthropicExisting: Record<string, unknown> = {};
    const migratedModels: Record<string, unknown> = {};
    if (isRecord(legacyClihopModels)) {
      for (const [modelId, modelConfig] of Object.entries(legacyClihopModels)) {
        if (chatIds.has(modelId)) migratedModels[modelId] = modelConfig;
        else anthropicExisting[modelId] = modelConfig;
      }
    }
    const savedOpenaiModels = existingProvidersById[OPEN_CODE_OPENAI_PROVIDER_ID].models;
    const openaiExisting: Record<string, unknown> = {
      ...migratedModels,
      ...(isRecord(savedOpenaiModels) ? savedOpenaiModels : {}),
    };

    const mergeModelEntries = (
      providerId: string,
      catalogue: RemoteModel[],
      existingModelsRecord: Record<string, unknown>
    ): { models: Record<string, unknown>; stale: string[] } => {
      const existingProvider = existingProvidersById[providerId];
      const existingOptions = existingProvider.options;
      if (existingOptions !== undefined && !isRecord(existingOptions)) {
        throw new Error(`${this.configPath} has an invalid ${providerId} options object${FIX_HINT}`);
      }
      const existingModels = existingProvider.models;
      if (existingModels !== undefined && !isRecord(existingModels)) {
        throw new Error(`${this.configPath} has an invalid ${providerId} models object${FIX_HINT}`);
      }

      const merged: Record<string, unknown> = {};
      for (const model of catalogue) {
        const existingModel = existingModelsRecord[model.id];
        if (existingModel !== undefined && !isRecord(existingModel)) {
          throw new Error(
            `${this.configPath} has an invalid ${providerId} model configuration for ${model.id}${FIX_HINT}`
          );
        }
        const gatewayName = model.displayName?.trim();
        merged[model.id] = {
          ...(existingModel ?? {}),
          // displayName wins so a gateway rename is picked up on the next sync;
          // the saved name only stands in for a model the gateway does not label.
          name:
            gatewayName ||
            (typeof existingModel?.name === "string" ? existingModel.name : model.id),
        };
      }

      // Only a live catalogue proves a model is gone: without wire capabilities
      // cli-hop fell back to its built-in pools (or the gateway advertised
      // none), so an absent id is not evidence of retirement. A model present
      // but on another wire is still served by the gateway - opencode just
      // reaches it through the other provider.
      const catalogueKnown = input.models.some((model) => model.apis?.length);
      const knownIds = new Set(input.models.map((model) => model.id));

      const stale: string[] = [];
      for (const [modelId, modelConfig] of Object.entries(existingModelsRecord)) {
        if (Object.hasOwn(merged, modelId)) continue;
        // Kept so a gateway rename never drops a configuration the user set up
        // by hand. Entries this CLI did not write (null, a string, ...) pass
        // through untouched: only ids it writes itself are shape-checked above.
        merged[modelId] = modelConfig;
        if (catalogueKnown && !knownIds.has(modelId)) stale.push(modelId);
      }
      return { models: merged, stale };
    };

    const anthropic = mergeModelEntries(
      OPEN_CODE_PROVIDER_ID,
      anthropicCatalogue,
      anthropicExisting
    );
    const openai = mergeModelEntries(
      OPEN_CODE_OPENAI_PROVIDER_ID,
      openaiCatalogue,
      openaiExisting
    );
    const staleModels = [...anthropic.stale, ...openai.stale];

    providers[OPEN_CODE_PROVIDER_ID] = {
      ...existingProvidersById[OPEN_CODE_PROVIDER_ID],
      npm: "@ai-sdk/anthropic",
      name: "CLI Hop",
      options: {
        ...(existingProvidersById[OPEN_CODE_PROVIDER_ID].options ?? {}),
        baseURL: `${input.endpoint.replace(/\/+$/, "")}/v1`,
        apiKey: "{env:CLI_HOP_API_KEY}",
      },
      models: anthropic.models,
    };
    providers[OPEN_CODE_OPENAI_PROVIDER_ID] = {
      ...existingProvidersById[OPEN_CODE_OPENAI_PROVIDER_ID],
      npm: "@ai-sdk/openai-compatible",
      name: "CLI Hop OpenAI-compatible",
      options: {
        ...(existingProvidersById[OPEN_CODE_OPENAI_PROVIDER_ID].options ?? {}),
        baseURL: `${input.endpoint.replace(/\/+$/, "")}/v1`,
        apiKey: "{env:CLI_HOP_API_KEY}",
      },
      models: openai.models,
    };

    const output: Record<string, unknown> = { ...document, provider: providers };
    // Installer parity: pin the default model (and small_model) to a
    // provider/model ref that matches the selected model's wire protocol, so
    // session helper traffic never falls back to a stale default.
    const selectedRef = selected
      ? `${providerRefFor(selected.apis).provider}/${selected.id}`
      : `${OPEN_CODE_PROVIDER_ID}/${input.selected}`;
    output.model = selectedRef;
    output.small_model = selectedRef;
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
