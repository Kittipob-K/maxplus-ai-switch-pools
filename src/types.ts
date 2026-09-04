export type AgentType = "claude-code" | "omp" | "openai" | "custom";

/**
 * Environment variables that must be cleared (unset) before launching
 * Claude Code so it falls back to its own credential/OAuth state instead
 * of an inherited proxy configuration.
 *
 * Equivalent to:
 *   unset ANTHROPIC_BASE_URL ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN \
 *         ANTHROPIC_TOKEN CLAUDE_CODE_OAUTH_TOKEN
 */
export const CLAUDE_CODE_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
] as const;

/**
 * Environment variables cleared before launching Oh My Pi: the same
 * Anthropic/proxy inheritance as Claude Code, plus omp/pi config-dir and
 * profile pointers that would relocate ~/.omp away from the file we wrote.
 */
export const OMP_ENV_KEYS = [
  ...CLAUDE_CODE_ENV_KEYS,
  "PI_CODING_AGENT_DIR",
  "PI_CONFIG_DIR",
  "OMP_PROFILE",
  "PI_PROFILE",
] as const;

export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  command: string;
  args?: string[];
  /** Env var names removed from the child process environment before spawn. */
  envToUnset?: readonly string[];
  /**
   * Per-agent overrides of the env vars that receive the primary API key /
   * base URL. When omitted, maxplus-ai applies the per-type defaults so a single
   * configured key and endpoint work with every agent CLI automatically.
   */
  apiEnvVarOverrides?: {
    apiKey?: readonly string[];
    baseUrl?: readonly string[];
  };
  /**
   * Prefix prepended to the model id when passing --model to the agent CLI
   * (e.g. "maxplus/" for omp, whose model selector is provider/modelId).
   */
  modelPrefix?: string;
}

/**
 * Which environment variables each agent type reads its API key from.
 * A new agent CLI of a known type automatically gets the primary API key
 * injected into these vars — no extra wiring needed.
 */
export const API_KEY_ENV_VARS_BY_TYPE: Record<AgentType, readonly string[]> = {
  "claude-code": ["ANTHROPIC_API_KEY"],
  // omp reads the key from the env var named by apiKey in models.yml.
  omp: ["MAXPLUS_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  custom: [],
};

/** Resolve the API key env vars for an agent (override or per-type default). */
export function apiKeyEnvVarsFor(agent: Agent): readonly string[] {
  return agent.apiEnvVarOverrides?.apiKey ?? API_KEY_ENV_VARS_BY_TYPE[agent.type];
}

/**
 * Which environment variables each agent type reads its base URL from.
 * The configured MaxPlus endpoint (e.g. https://api.maxplus-ai.cc) is
 * exported to these vars when launching, equivalent to:
 *   export ANTHROPIC_BASE_URL=https://api.maxplus-ai.cc
 */
export const BASE_URL_ENV_VARS_BY_TYPE: Record<AgentType, readonly string[]> = {
  "claude-code": ["ANTHROPIC_BASE_URL"],
  // omp's base URL lives in ~/.omp/agent/models.yml, not in env.
  omp: [],
  openai: ["OPENAI_BASE_URL"],
  custom: [],
};

/** Resolve the base URL env vars for an agent (override or per-type default). */
export function baseUrlEnvVarsFor(agent: Agent): readonly string[] {
  return agent.apiEnvVarOverrides?.baseUrl ?? BASE_URL_ENV_VARS_BY_TYPE[agent.type];
}

/** User settings persisted in ~/.config/maxplus-ai/settings.json */
export interface Settings {
  /** Primary API key injected into every agent CLI that reads a key from env. */
  apiKey?: string;
  /** Base URL of the MaxPlus models API. Default: https://api.maxplus-ai.cc/v1 */
  baseUrl?: string;
}

/** Default MaxPlus API endpoint used to list selectable models/pools. */
export const DEFAULT_MODELS_BASE_URL = "https://api.maxplus-ai.cc/v1";

/** A model/pool entry returned by the MaxPlus /models endpoint. */
export interface RemoteModel {
  id: string;
  displayName?: string;
  type?: string;
  /**
   * Wire protocols the gateway serves this model on, from the response's
   * maxplus.models capability map (e.g. ["messages", "chat_completions"]).
   */
  apis?: string[];
}

/** Shape of the Anthropic-style paginated /models response. */
export interface ModelsResponse {
  data?: Array<{ id: string; display_name?: string; type?: string }>;
  first_id?: string;
  last_id?: string;
  has_more?: boolean;
  /** MaxPlus extension: model ids grouped by supported wire protocol. */
  maxplus?: {
    capabilities?: string[];
    models?: Record<string, string[]>;
  };
}

export interface RunOptions {
  pool?: string;
  model?: string;
  agent?: AgentType;
  args?: string[];
  /** Primary API key from settings; injected per agent type's env vars. */
  apiKey?: string;
  /** MaxPlus endpoint (without /v1) exported as the agent's base URL. */
  baseUrl?: string;
}

export interface Pool {
  id: string;
  name: string;
  model: string;
  agents: Agent[];
}
