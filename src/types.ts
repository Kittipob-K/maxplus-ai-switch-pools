export type WireProtocol = "messages" | "chat_completions" | "responses";

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

/**
 * Environment variables cleared before launching Pi. Pi reads its managed
 * provider configuration from ~/.pi/agent/models.json; an inherited config
 * directory or MaxPlus key must not override settings managed by this CLI.
 */
export const PI_ENV_KEYS = [
  ...CLAUDE_CODE_ENV_KEYS,
  "MAXPLUS_API_KEY",
  "PI_CODING_AGENT_DIR",
] as const;

export const OPENAI_COMPATIBLE_ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_API_BASE",
  "OPENAI_BASE_URL",
] as const;

export const GATEWAY_CREDENTIAL_ENV_KEYS = [
  ...CLAUDE_CODE_ENV_KEYS,
  ...OPENAI_COMPATIBLE_ENV_KEYS,
  "MAXPLUS_API_KEY",
] as const;

export interface Agent {
  id: string;
  name: string;
  command: string;
  args?: string[];
  /** Env var names removed from the child process environment before spawn. */
  envToUnset?: readonly string[];
  /**
   * Per-agent overrides of the env vars that receive the primary API key /
   * base URL. When omitted, maxplus-ai applies the per-type defaults so a single
   * configured key and endpoint work with every agent CLI automatically.
   */
  apiKeyEnvVars: readonly string[];
  baseUrlEnvVars: readonly string[];
  /**
   * Prefix prepended to the model id when passing --model to the agent CLI
   * (e.g. "maxplus/" for omp, whose model selector is provider/modelId).
   */
  modelPrefix?: string;
  /** MaxPlus wire protocols this CLI can use. */
  supportedProtocols: readonly WireProtocol[];
  /** Optional suffix applied to the normalized endpoint before env export. */
  baseUrlSuffix?: string;
  /** Override the generic --model argument construction when needed. */
  buildArgs?: (options: RunOptions) => string[];
  /** Prepare persistent CLI configuration before launch. */
  prepare?: (input: AgentPreparationInput) => Promise<string[]>;
  /** Optional cleanup offered only in the interactive customize flow. */
  scrubShellConfig?: () => Promise<string[]>;
  installUrl?: string;
}

/**
 * Which environment variables each agent reads its API key from.
 * A registered agent automatically gets the primary API key
 * injected into these vars — no extra wiring needed.
 */
/** Resolve the API key env vars for an agent (override or per-type default). */
export function apiKeyEnvVarsFor(agent: Agent): readonly string[] {
  return agent.apiKeyEnvVars;
}

/**
 * Which environment variables each agent reads its base URL from.
 * The configured MaxPlus endpoint (e.g. https://api.maxplus-ai.cc) is
 * exported to these vars when launching, equivalent to:
 *   export ANTHROPIC_BASE_URL=https://api.maxplus-ai.cc
 */
/** Resolve the base URL env vars for an agent (override or per-type default). */
export function baseUrlEnvVarsFor(agent: Agent): readonly string[] {
  return agent.baseUrlEnvVars;
}

/** User settings persisted in ~/.config/maxplus-ai/settings.json */
export interface Settings {
  /**
   * Primary API key injected into every agent CLI that reads a key from env.
   * The Credential Store (OS keychain) is authoritative at rest: SettingsService
   * returns it from the keychain when available and persists it there, using
   * this file only as the fallback location on systems with no usable keychain.
   */
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
  args?: string[];
  /** Primary API key from settings; injected into the selected agent's env vars. */
  apiKey?: string;
  /** MaxPlus endpoint (without /v1) exported as the agent's base URL. */
  baseUrl?: string;
}

export interface LaunchPlan {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export interface AgentPreparationInput {
  apiKey: string;
  endpoint: string;
  models: RemoteModel[];
  selected: string;
}

export interface Pool {
  id: string;
  name: string;
  model: string;
  agents: Agent[];
}
