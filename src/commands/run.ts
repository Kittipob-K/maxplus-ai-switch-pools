import { Command } from "commander";
import chalk from "chalk";
import { select } from "@inquirer/prompts";
import { PoolService } from "../services/pool.js";
import { AgentService } from "../services/agent.js";
import type { AgentType, RunOptions } from "../types.js";

export const runCommand = new Command("run")
  .description("Run an AI agent with selected pool/model")
  .option("-p, --pool <id>", "Pool ID to use")
  .option("-m, --model <model>", "Model name to use")
  .option("-a, --agent <type>", "Agent type (claude-code, openai, custom)")
  .argument("[args...]", "Additional arguments to pass to the agent")
  .action(async (args: string[], options) => {
    const poolService = new PoolService();
    const agentService = new AgentService();

    try {
      // Select pool if not specified
      let poolId = options.pool;
      if (!poolId) {
        const pools = poolService.listPools();
        poolId = await select({
          message: "Select a pool:",
          choices: pools.map((p) => ({
            name: `${p.name} (${p.model})`,
            value: p.id,
          })),
        });
      }

      const pool = poolService.getPool(poolId);
      if (!pool) {
        console.error(chalk.red(`Pool "${poolId}" not found`));
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
        console.error(chalk.red(`Agent not found`));
        process.exit(1);
      }

      console.log(
        chalk.cyan(`\n🚀 Starting ${agent.name} with model ${pool.model}\n`)
      );

      const runOptions: RunOptions = {
        pool: poolId,
        model: options.model ?? pool.model,
        agent: agent.type,
        args,
      };

      const exitCode = await agentService.run(agent, runOptions);
      process.exit(exitCode);
    } catch (err) {
      if (err instanceof Error && err.name === "ExitPromptError") {
        // User cancelled - graceful exit
        process.exit(0);
      }
      console.error(chalk.red("Error:"), err);
      process.exit(1);
    }
  });
