import { Command } from "commander";
import chalk from "chalk";
import { PoolService } from "../services/pool.js";

export const listCommand = new Command("list")
  .description("List available pools and agents")
  .action(() => {
    const poolService = new PoolService();
    const pools = poolService.listPools();

    console.log(chalk.bold("\n📋 Available Pools:\n"));

    for (const pool of pools) {
      console.log(chalk.cyan(`  ${pool.id}`));
      console.log(chalk.gray(`    Name:  ${pool.name}`));
      console.log(chalk.gray(`    Model: ${pool.model}`));
      console.log(
        chalk.gray(
          `    Agents: ${pool.agents.map((a) => a.name).join(", ")}`
        )
      );
      console.log();
    }
  });
