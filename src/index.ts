#!/usr/bin/env node

import { Command } from "commander";
import { runCommand } from "./commands/run.js";
import { listCommand } from "./commands/list.js";

const program = new Command();

program
  .name("masp")
  .description("MaxPlus AI Switch Pools - Switch AI models and agents easily")
  .version("0.1.0");

program.addCommand(runCommand);
program.addCommand(listCommand);

program.parse();
