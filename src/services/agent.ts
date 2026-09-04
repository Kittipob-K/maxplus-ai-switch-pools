import { spawn } from "node:child_process";
import type { Agent, RunOptions } from "../types.js";

export class AgentService {
  async run(agent: Agent, options: RunOptions = {}): Promise<number> {
    const args = this.buildArgs(agent, options);
    const { promise, resolve, reject } = Promise.withResolvers<number>();

    const child = spawn(agent.command, args, {
      stdio: "inherit",
      shell: true,
    });

    child.on("close", (code) => {
      resolve(code ?? 0);
    });

    child.on("error", (err) => {
      reject(err);
    });

    return promise;
  }

  private buildArgs(agent: Agent, options: RunOptions): string[] {
    const args: string[] = [...(agent.args ?? [])];

    // Add model flag if specified
    if (options.model) {
      args.push("--model", options.model);
    }

    // Add any extra args
    if (options.args) {
      args.push(...options.args);
    }

    return args;
  }
}
