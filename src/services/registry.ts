import type { Agent } from "../types.js";
import { CLAUDE_CODE_ENV_KEYS } from "../types.js";

/**
 * Registry of agent CLIs that can be customized through maxplus-ai.
 * Extend this list as more agents are supported (openai, custom, ...).
 */
export const CUSTOMIZABLE_AGENTS: Agent[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    type: "claude-code",
    command: "claude",
    // Before launching Claude Code, unset the inherited Anthropic/proxy
    // credentials so maxplus-ai can manage them explicitly. The primary API key
    // from settings is then injected per-type (see API_KEY_ENV_VARS_BY_TYPE).
    envToUnset: CLAUDE_CODE_ENV_KEYS,
  },
];

/** Agents shown in the "select which CLI to customize" prompt. */
export interface AgentOption {
  name: string;
  value: string;
  disabled?: boolean | string;
}

export function listAgentOptions(): AgentOption[] {
  return CUSTOMIZABLE_AGENTS.map((a) => ({ name: a.name, value: a.id }));
}

export function getAgentById(id: string): Agent | undefined {
  return CUSTOMIZABLE_AGENTS.find((a) => a.id === id);
}
