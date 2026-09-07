import type { Agent } from "../types.js";
import type { RemoteModel } from "../types.js";
import {
  CLAUDE_CODE_ENV_KEYS,
  CODEX_ENV_KEYS,
  GROK_ENV_KEYS,
  OMP_ENV_KEYS,
  OPENAI_COMPATIBLE_ENV_KEYS,
  PI_ENV_KEYS,
} from "../types.js";
import { ClaudeConfigService } from "./claude-config.js";
import { CodexConfigService } from "./codex-config.js";
import { GrokConfigService } from "./grok-config.js";
import { OmpConfigService } from "./omp-config.js";
import { OpenCodeConfigService } from "./opencode-config.js";
import { PiConfigService } from "./pi-config.js";
import { scrubShellRc } from "./shell-scrub.js";
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
    // Installer parity: messages-capable models go through the Anthropic-shaped
    // provider, chat_completions through the OpenAI-compatible one.
    supportedProtocols: ["messages", "chat_completions"],
    modelPrefix: "maxplus/",
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
    envToUnset: ["MAXPLUS_API_KEY", ...OPENAI_COMPATIBLE_ENV_KEYS, ...CODEX_ENV_KEYS],
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
    // Installer parity: deploy ~/.codex/config.toml, maxplus.config.toml,
    // and auth.json so `codex` works standalone, not only through maxplus-ai.
    prepare: async ({ apiKey, endpoint, selected }) =>
      new CodexConfigService().apply({ apiKey, endpoint, model: selected }),
    scrubShellConfig: () =>
      scrubShellRc([
        "CODEX_API_KEY",
        "CODEX_ACCESS_TOKEN",
        "OPENAI_BASE_URL",
        "OPENAI_API_KEY",
        "MAXPLUS_CODEX_API_KEY",
        "MAXPLUS_OC_CODEX_API_KEY",
        "MAXPLUS_HERMES_CODEX_API_KEY",
      ]),
    installUrl: "https://developers.openai.com/codex/cli/",
  },
  {
    id: "grok",
    name: "Grok Build",
    command: "grok",
    // Grok reads the key from the inline api_key inside the managed
    // ~/.grok/config.toml block — no API-key env var, installer parity.
    apiKeyEnvVars: [],
    baseUrlEnvVars: [],
    envToUnset: [...GROK_ENV_KEYS],
    supportedProtocols: ["responses"],
    // The managed config block pins the default model; the launch only
    // forwards the user's own arguments.
    buildArgs: (options) => (options.args ? [...options.args] : []),
    prepare: async ({ apiKey, endpoint, models, selected }) => {
      const model = models.find((candidate) => candidate.id === selected);
      return new GrokConfigService().apply({
        apiKey,
        endpoint,
        model: selected,
        displayName: model?.displayName,
        contextWindow: selected === "grok-4.5" ? 1000000 : undefined,
      });
    },
    scrubShellConfig: () => scrubShellRc([
      "MAXPLUS_API_KEY",
      "MAXPLUS_AI_API_KEY",
      "MAXPLUS_CODEX_API_KEY",
      "MAXPLUS_OC_CODEX_API_KEY",
      "MAXPLUS_HERMES_CODEX_API_KEY",
      "CUSTOM_API_KEY",
    ]),
    installUrl: "https://x.ai/cli",
  },
];

/** Agents shown in the "select which CLI to customize" prompt. */
export interface AgentOption {
  name: string;
  value: string;
  disabled?: boolean | string;
}

export function listAgentOptions(lastAgentId?: string): AgentOption[] {
  const options = CUSTOMIZABLE_AGENTS.map((agent) => ({
    name: agent.id === lastAgentId ? `${agent.name} (latest)` : agent.name,
    value: agent.id,
  }));
  const latestIndex = options.findIndex((option) => option.value === lastAgentId);

  if (latestIndex > 0) {
    const [latest] = options.splice(latestIndex, 1);
    options.unshift(latest);
  }
  return options;
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
