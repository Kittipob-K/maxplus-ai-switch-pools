import { spawn } from "node:child_process";
import type { Agent, RunOptions } from "../types.js";
import { apiKeyEnvVarsFor, baseUrlEnvVarsFor } from "../types.js";

export class AgentService {
  /**
   * Build a clean environment for the agent: remove (unset) every env var
   * listed in agent.envToUnset, then export the primary API key and the
   * MaxPlus base URL from settings into the env vars the agent's type reads
   * them from — equivalent to:
   *   export ANTHROPIC_BASE_URL=https://api.maxplus-ai.cc
   *   export ANTHROPIC_API_KEY=<primary key>
   */
  prepareEnv(agent: Agent, options: RunOptions = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of agent.envToUnset ?? []) {
      delete env[key];
    }
    if (options.apiKey) {
      for (const key of apiKeyEnvVarsFor(agent)) {
        env[key] = options.apiKey;
      }
    }
    if (options.baseUrl) {
      for (const key of baseUrlEnvVarsFor(agent)) {
        env[key] = options.baseUrl;
      }
    }
    return env;
  }

  /** Report which env vars were unset (those that were actually present). */
  getUnsetVars(agent: Agent): string[] {
    return (agent.envToUnset ?? []).filter((key) => key in process.env);
  }

  /**
   * Perform the `unset` for real on the current process environment so every
   * later step (and any spawned agent) sees a clean environment.
   * Returns the names of the variables that were actually removed.
   */
  applyUnset(agent: Agent): string[] {
    const removed = this.getUnsetVars(agent);
    for (const key of removed) {
      delete process.env[key];
    }
    return removed;
  }

  async run(agent: Agent, options: RunOptions = {}): Promise<number> {
    const args = this.buildArgs(agent, options);
    const env = this.prepareEnv(agent, options);
    const { promise, resolve, reject } = Promise.withResolvers<number>();

    const child = spawn(agent.command, args, {
      stdio: "inherit",
      shell: false,
      env,
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
