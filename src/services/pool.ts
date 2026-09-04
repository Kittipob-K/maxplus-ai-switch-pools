import type { ModelsResponse, Pool, RemoteModel } from "../types.js";
import { DEFAULT_MODELS_BASE_URL } from "../types.js";
import { CUSTOMIZABLE_AGENTS } from "./registry.js";

// Default pools configuration - will be extended with config file support
const DEFAULT_POOLS: Pool[] = [
  {
    id: "claude-default",
    name: "Claude Default",
    model: "claude-sonnet-4-20250514",
    agents: CUSTOMIZABLE_AGENTS,
  },
  {
    id: "claude-fast",
    name: "Claude Fast",
    model: "claude-haiku-3",
    agents: CUSTOMIZABLE_AGENTS,
  },
];

export class PoolService {
  private pools: Pool[];

  constructor() {
    this.pools = DEFAULT_POOLS;
  }

  listPools(): Pool[] {
    return this.pools;
  }

  getPool(id: string): Pool | undefined {
    return this.pools.find((p) => p.id === id);
  }

  getPoolByModel(model: string): Pool | undefined {
    return this.pools.find((p) => p.model === model);
  }

  /**
   * Pull the model/pool catalogue from the MaxPlus API
   * (GET {baseUrl}/models with "Authorization: Bearer <apiKey>"),
   * following cursor pagination until exhausted.
   */
  async fetchRemoteModels(
    apiKey: string,
    baseUrl: string = DEFAULT_MODELS_BASE_URL,
    signal?: AbortSignal
  ): Promise<RemoteModel[]> {
    const models: RemoteModel[] = [];
    let afterId: string | undefined;

    for (;;) {
      const url = new URL("models", baseUrl.replace(/\/+$/, "") + "/");
      if (afterId) url.searchParams.set("after_id", afterId);

      const res = await fetch(url, {
        signal: signal ?? AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "anthropic-version": "2023-06-01",
        },
      });

      if (!res.ok) {
        throw new Error(
          `Models API returned ${res.status} ${res.statusText}` +
            (res.status === 401 ? " — check your API key in Settings" : "")
        );
      }

      const body = (await res.json()) as ModelsResponse;
      // maxplus.models groups ids by wire protocol (messages,
      // chat_completions, responses, …) — invert it for per-model lookup.
      const caps = new Map<string, string[]>();
      for (const [api, ids] of Object.entries(body.maxplus?.models ?? {})) {
        for (const id of ids) caps.set(id, [...(caps.get(id) ?? []), api]);
      }
      for (const m of body.data ?? []) {
        models.push({
          id: m.id,
          displayName: m.display_name,
          type: m.type,
          apis: caps.get(m.id),
        });
      }

      if (!body.has_more || !body.last_id) break;
      afterId = body.last_id;
    }

    return models;
  }

  /**
   * Build selectable Pool entries from remote models. Every MaxPlus model
   * is reachable through all registered agent CLIs; the wire protocol is
   * resolved per model (see RemoteModel.apis).
   */
  poolsFromRemoteModels(models: RemoteModel[]): Pool[] {
    return models.map((m) => ({
      id: `remote:${m.id}`,
      name: m.displayName ?? m.id,
      model: m.id,
      agents: CUSTOMIZABLE_AGENTS,
    }));
  }

  /**
   * Resolve the pools offered to the user: the live MaxPlus model catalogue
   * when an API key is configured and reachable, otherwise the built-in
   * local pools. Never throws — API problems are reported via `error`.
   */
  async resolvePools(opts: {
    apiKey?: string;
    baseUrl?: string;
    onProgress?: (msg: string) => void;
  }): Promise<{
    pools: Pool[];
    source: "remote" | "local";
    error?: string;
    /** Raw catalogue (with wire capabilities) when source is "remote". */
    models?: RemoteModel[];
  }> {
    if (!opts.apiKey) {
      return { pools: this.pools, source: "local" };
    }

    try {
      opts.onProgress?.("Fetching models from MaxPlus API…");
      const models = await this.fetchRemoteModels(
        opts.apiKey,
        opts.baseUrl ?? DEFAULT_MODELS_BASE_URL
      );
      if (models.length === 0) {
        return {
          pools: this.pools,
          source: "local",
          error: "API returned no models",
        };
      }
      return {
        pools: this.poolsFromRemoteModels(models),
        source: "remote",
        models,
      };
    } catch (err) {
      return {
        pools: this.pools,
        source: "local",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
