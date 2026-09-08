import { Command } from "commander";
import { select } from "@inquirer/prompts";
import { LaunchCoordinator } from "../services/launch.js";
import { SettingsService } from "../services/settings.js";
import { ensurePrerequisites } from "../services/prereq.js";
import { ensureAgentInstalled } from "../services/installer.js";
import {
  agentSupportsModel,
  CUSTOMIZABLE_AGENTS,
  getAgentById,
  isAgentId,
} from "../services/registry.js";
import * as ui from "../ui.js";

export const runCommand = new Command("run")
  .description("Run an AI agent with selected pool/model")
  .option("-p, --pool <id>", "Pool ID to use")
  .option("-m, --model <model>", "Model name to use")
  .option(
    "-a, --agent <type>",
    `Agent type (${CUSTOMIZABLE_AGENTS.map((agent) => agent.id).join(", ")})`
  )
  .argument("[args...]", "Additional arguments to pass to the agent")
  .action(async (args: string[], options) => {
    const launch = new LaunchCoordinator();
    const settingsService = new SettingsService();

    try {
      // Settings must exist before we can do anything: check BASE_URL and
      // API_KEY, prompting for missing values (next-best-step flow).
      const settings = await ensurePrerequisites(settingsService);

      const requestedAgent = options.agent as string | undefined;
      if (requestedAgent && !isAgentId(requestedAgent)) {
        ui.danger(
          `Unknown agent "${requestedAgent}". Choose one of: ${CUSTOMIZABLE_AGENTS.map((agent) => agent.id).join(", ")}`
        );
        process.exit(1);
      }

      // Install check for explicitly requested agent: validate the binary
      // exists BEFORE fetching pools to avoid wasting the API call.
      if (requestedAgent) {
        const requestedAgentObj = getAgentById(requestedAgent);
        if (requestedAgentObj && !(await ensureAgentInstalled(requestedAgentObj))) {
          process.exit(1);
        }
      }

      // Resolve selectable pools: live CLI Hop model list when available,
      // otherwise the built-in local pools.
      const spinner = new ui.Spinner("Fetching models from CLI Hop API");
      const { pools, source, error, models } = await launch.resolvePools(settings);
      spinner.stop();
      if (error) ui.warn(`${error} — using local pools`);
      if (source === "remote") ui.ok(`${pools.length} models loaded from API`);

      const selectablePools = requestedAgent
        ? pools.filter((pool) =>
            pool.agents.some((agent) => agent.id === requestedAgent)
          )
        : pools;

      // Select pool if not specified
      let poolId = options.pool;
      if (!poolId) {
        poolId = await select({
          message: "Select a pool:",
          choices: selectablePools.map((p) => ({
            name: `${p.name} (${p.model})`,
            value: p.id,
          })),
        });
      }

      const pool =
        pools.find((p) => p.id === poolId) ?? launch.poolService.getPool(poolId);
      if (!pool) {
        ui.danger(`Pool "${poolId}" not found`);
        process.exit(1);
      }

      // Select agent if not specified
      let agentType = requestedAgent;
      if (!agentType && pool.agents.length > 1) {
        agentType = await select({
          message: "Select an agent:",
          choices: pool.agents.map((a) => ({
            name: a.name,
            value: a.id,
          })),
        });
      }

      const agent = agentType
        ? getAgentById(agentType)
        : pool.agents[0];

      if (!agent) {
        ui.danger("Agent not found");
        process.exit(1);
      }

      if (!options.model && !pool.agents.some((candidate) => candidate.id === agent.id)) {
        ui.danger(`${agent.name} does not support the protocols advertised by ${pool.model}`);
        process.exit(1);
      }
      const selectedModel = options.model ?? pool.model;
      if (models) {
        const remoteModel = models.find((model) => model.id === selectedModel);
        if (!remoteModel) {
          ui.danger(`Model "${selectedModel}" is not in the CLI Hop catalogue.`);
          process.exit(1);
        }
        if (!agentSupportsModel(agent, remoteModel)) {
          ui.danger(
            `${agent.name} does not support the protocols advertised by ${selectedModel}`
          );
          process.exit(1);
        }
      }
      const prepared = await launch.prepare({
        agent,
        model: selectedModel,
        args,
        poolId,
        settings,
        models,
      });
      for (const file of prepared.changedFiles) ui.ok(ui.filepath(file));
      ui.h2(`🚀 Starting ${agent.name} with model ${selectedModel}`);
      process.exit(await launch.runPrepared(agent, prepared));
    } catch (err) {
      if (err instanceof Error && err.name === "ExitPromptError") {
        // User cancelled - graceful exit
        process.exit(0);
      }
      ui.danger(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
