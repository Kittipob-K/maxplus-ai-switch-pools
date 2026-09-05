import type { Agent } from "../types.js";
import type { RemoteModel } from "../types.js";
import {
  CLAUDE_CODE_ENV_KEYS,
  OMP_ENV_KEYS,
  OPENAI_COMPATIBLE_ENV_KEYS,
  PI_ENV_KEYS,
} from "../types.js";
import { ClaudeConfigService } from "./claude-config.js";
import { OmpConfigService } from "./omp-config.js";
import { OpenCodeConfigService } from "./opencode-config.js";
import { PiConfigService } from "./pi-config.js";
import * as ui from "../ui.js";

/**
 * Registry of agent CLIs that can be customized through maxplus-ai.
 * Extend this list as more agents are supported (openai, custom, ...).
 */
export const CUSTOMIZABLE_AGENTS: Agent[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    command: "claude",
    apiKeyEnvVars: ["ANTHROPIC_API_KEY"],
    baseUrlEnvVars: ["ANTHROPIC_BASE_URL"],
    // Before launching Claude Code, unset the inherited Anthropic/proxy
    // credentials so maxplus-ai can manage them explicitly. The primary API key
    // from settings is then injected through the registry env mapping.
    envToUnset: CLAUDE_CODE_ENV_KEYS,
    supportedProtocols: ["messages"],
    prepare: async ({ apiKey, endpoint, selected }) =>
      new ClaudeConfigService().apply({ apiKey, endpoint, model: selected }),
    scrubShellConfig: () => new ClaudeConfigService().scrubShellRc(),
    installUrl: "https://docs.anthropic.com/en/docs/claude-code",
  },
  {
    id: "omp",
    name: "Oh My Pi",
    command: "omp",
    apiKeyEnvVars: ["MAXPLUS_API_KEY"],
    baseUrlEnvVars: [],
    // Inherited Anthropic/proxy vars plus pi/omp config-dir pointers that
    // would relocate ~/.omp away from the models.yml we write.
    envToUnset: OMP_ENV_KEYS,
    // omp's --model selector is provider/modelId; prefix disambiguates the
    // MaxPlus copy from built-in providers with the same ids.
    modelPrefix: "maxplus/",
    supportedProtocols: ["messages", "chat_completions", "responses"],
    prepare: async ({ endpoint, models, selected }) => [
      await new OmpConfigService().apply({ endpoint, models, selected }),
    ],
    installUrl: "https://github.com/can1357/oh-my-pi",
  },
  {
    id: "pi",
    name: "Pi",
    command: "pi",
    apiKeyEnvVars: ["MAXPLUS_API_KEY"],
    baseUrlEnvVars: [],
    envToUnset: PI_ENV_KEYS,
    modelPrefix: "maxplus/",
    supportedProtocols: ["messages", "chat_completions", "responses"],
    prepare: async ({ endpoint, models, selected }) => [
      await new PiConfigService().apply({ endpoint, models, selected }),
    ],
    installUrl: "https://pi.dev/docs/latest",
  },
  {
    id: "aider",
    name: "Aider",
    command: "aider",
    apiKeyEnvVars: ["OPENAI_API_KEY"],
    baseUrlEnvVars: ["OPENAI_API_BASE"],
    envToUnset: OPENAI_COMPATIBLE_ENV_KEYS,
    modelPrefix: "openai/",
    baseUrlSuffix: "/v1",
    supportedProtocols: ["chat_completions"],
    installUrl: "https://aider.chat/docs/install.html",
  },
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    apiKeyEnvVars: ["MAXPLUS_API_KEY"],
    baseUrlEnvVars: [],
    envToUnset: ["MAXPLUS_API_KEY", ...OPENAI_COMPATIBLE_ENV_KEYS],
    modelPrefix: "maxplus/",
    supportedProtocols: ["chat_completions"],
    prepare: async ({ endpoint, models, selected }) => {
      const result = await new OpenCodeConfigService().apply({
        endpoint,
        models,
        selected,
      });
      for (const modelId of result.staleModels) {
        ui.warn(
          `stale MaxPlus model ${ui.val(`maxplus/${modelId}`)} kept in opencode.json - the gateway no longer serves it; remove it from the file to prune`
        );
      }
      return [result.path];
    },
    installUrl: "https://opencode.ai/docs/",
  },
  {
    id: "codex",
    name: "Codex CLI",
    command: "codex",
    apiKeyEnvVars: ["MAXPLUS_API_KEY"],
    baseUrlEnvVars: [],
    envToUnset: ["MAXPLUS_API_KEY", ...OPENAI_COMPATIBLE_ENV_KEYS],
    supportedProtocols: ["responses"],
    buildArgs: (options) => {
      const endpoint = options.baseUrl?.replace(/\/+$/, "");
      const args = options.model ? ["--model", options.model] : [];
      if (endpoint) {
        args.push(
          "-c", 'model_provider="maxplus"',
          "-c", 'model_providers.maxplus.name="MaxPlus"',
          "-c", `model_providers.maxplus.base_url=${JSON.stringify(`${endpoint}/v1`)}`,
          "-c", 'model_providers.maxplus.env_key="MAXPLUS_API_KEY"',
          "-c", 'model_providers.maxplus.wire_api="responses"'
        );
      }
      if (options.args) args.push(...options.args);
      return args;
    },
    installUrl: "https://developers.openai.com/codex/cli/",
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

export function isAgentId(value: string): boolean {
  return CUSTOMIZABLE_AGENTS.some((agent) => agent.id === value);
}

export function agentSupportsModel(agent: Agent, model: RemoteModel): boolean {
  return !model.apis?.length || agent.supportedProtocols.some((protocol) =>
    model.apis?.includes(protocol)
  );
}
