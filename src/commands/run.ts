import { Command } from "commander";
import { select } from "@inquirer/prompts";
import { PoolService } from "../services/pool.js";
import { AgentService } from "../services/agent.js";
import { SettingsService } from "../services/settings.js";
import { ensurePrerequisites } from "../services/prereq.js";
import { ClaudeConfigService } from "../services/claude-config.js";
import { DEFAULT_MODELS_BASE_URL } from "../types.js";
import type { AgentType, RunOptions } from "../types.js";
import * as ui from "../ui.js";

export const runCommand = new Command("run")
  .description("Run an AI agent with selected pool/model")
  .option("-p, --pool <id>", "Pool ID to use")
  .option("-m, --model <model>", "Model name to use")
  .option("-a, --agent <type>", "Agent type (claude-code, openai, custom)")
  .argument("[args...]", "Additional arguments to pass to the agent")
  .action(async (args: string[], options) => {
    const poolService = new PoolService();
    const agentService = new AgentService();
    const settingsService = new SettingsService();

    try {
      // Settings must exist before we can do anything: check BASE_URL and
      // API_KEY, prompting for missing values (next-best-step flow).
      const settings = await ensurePrerequisites(settingsService);

      // Resolve selectable pools: live MaxPlus model list when available,
      // otherwise the built-in local pools.
      const spinner = new ui.Spinner("Fetching models from MaxPlus API");
      const { pools, source, error } = await poolService.resolvePools({
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
      });
      spinner.stop();
      if (error) ui.warn(`${error} — using local pools`);
      if (source === "remote") ui.ok(`${pools.length} models loaded from API`);

      // Select pool if not specified
      let poolId = options.pool;
      if (!poolId) {
        poolId = await select({
          message: "Select a pool:",
          choices: pools.map((p) => ({
            name: `${p.name} (${p.model})`,
            value: p.id,
          })),
        });
      }

      const pool =
        pools.find((p) => p.id === poolId) ?? poolService.getPool(poolId);
      if (!pool) {
        ui.danger(`Pool "${poolId}" not found`);
        process.exit(1);
      }

      // Select agent if not specified
      let agentType = options.agent as AgentType | undefined;
      if (!agentType && pool.agents.length > 1) {
        agentType = await select({
          message: "Select an agent:",
          choices: pool.agents.map((a) => ({
            name: a.name,
            value: a.type,
          })),
        });
      }

      const agent = agentType
        ? pool.agents.find((a) => a.type === agentType)
        : pool.agents[0];

      if (!agent) {
        ui.danger("Agent not found");
        process.exit(1);
      }

      ui.h2(`🚀 Starting ${agent.name} with model ${pool.model}`);

      const runOptions: RunOptions = {
        pool: poolId,
        model: options.model ?? pool.model,
        agent: agent.type,
        args,
        apiKey: settings.apiKey,
        baseUrl: settings.apiKey
          ? ClaudeConfigService.endpointFromBaseUrl(
              settings.baseUrl ?? DEFAULT_MODELS_BASE_URL
            )
          : undefined,
      };

      const exitCode = await agentService.run(agent, runOptions);
      process.exit(exitCode);
    } catch (err) {
      if (err instanceof Error && err.name === "ExitPromptError") {
        // User cancelled - graceful exit
        process.exit(0);
      }
      ui.danger(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
