#!/usr/bin/env node

import { Command } from "commander";
import { runCommand } from "./commands/run.js";
import { listCommand } from "./commands/list.js";
import { customizeCommand } from "./commands/customize.js";
import { settingsCommand } from "./commands/settings.js";

const program = new Command();

program
  .name("maxplus-ai")
  .description("MaxPlus AI Switch Pools - Switch AI models and agents easily")
  .version("0.1.0");

program.addCommand(runCommand);
program.addCommand(listCommand);
program.addCommand(customizeCommand);
program.addCommand(settingsCommand);

// Default flow: opening `maxplus-ai` with no subcommand launches the
// "which agents CLI do you want to customize?" selector.
const userArgs = process.argv.slice(2);
if (userArgs.length === 0) {
  await customizeCommand.parseAsync(["node", "maxplus-ai"]);
} else {
  await program.parseAsync();
}
