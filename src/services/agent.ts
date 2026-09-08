import { spawn } from "node:child_process";
import type { Agent, AgentPreparationInput, LaunchPlan, RunOptions } from "../types.js";
import {
  apiKeyEnvVarsFor,
  baseUrlEnvVarsFor,
  GATEWAY_CREDENTIAL_ENV_KEYS,
} from "../types.js";

export class AgentService {
  async prepare(agent: Agent, input: AgentPreparationInput): Promise<string[]> {
    return agent.prepare ? agent.prepare(input) : [];
  }

  async scrubShellConfig(agent: Agent): Promise<string[]> {
    return agent.scrubShellConfig ? agent.scrubShellConfig() : [];
  }
  /**
   * Build a clean environment for the agent: remove (unset) every env var
   * listed in agent.envToUnset, then export the primary API key and the
   * CLI Hop base URL from settings into the env vars the agent's type reads
   * them from — equivalent to:
   *   export ANTHROPIC_BASE_URL=https://api.cli-hop.cc
   *   export ANTHROPIC_API_KEY=<primary key>
   */
  prepareEnv(agent: Agent, options: RunOptions = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    const keysToUnset = new Set([
      ...GATEWAY_CREDENTIAL_ENV_KEYS,
      ...(agent.envToUnset ?? []),
    ]);
    for (const key of keysToUnset) {
      delete env[key];
    }
    if (options.apiKey) {
      for (const key of apiKeyEnvVarsFor(agent)) {
        env[key] = options.apiKey;
      }
    }
    if (options.baseUrl) {
      const normalizedBaseUrl = options.baseUrl.replace(/\/+$/, "");
      const baseUrl = normalizedBaseUrl + (agent.baseUrlSuffix ?? "");
      for (const key of baseUrlEnvVarsFor(agent)) {
        env[key] = baseUrl;
      }
    }
    return env;
  }

  /** Report which env vars were unset (those that were actually present). */
  getUnsetVars(agent: Agent): string[] {
    return [...new Set([...GATEWAY_CREDENTIAL_ENV_KEYS, ...(agent.envToUnset ?? [])])].filter(
      (key) => key in process.env
    );
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
    const plan = this.createLaunchPlan(agent, options);
    const { promise, resolve, reject } = Promise.withResolvers<number>();

    const child = spawn(plan.command, plan.args, {
      stdio: "inherit",
      shell: false,
      env: plan.env,
    });

    child.on("close", (code) => {
      resolve(code ?? 0);
    });

    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        const installHint = agent.installUrl
          ? ` Install it from ${agent.installUrl}`
          : "";
        reject(new Error(`${agent.name} is not installed or is not on PATH.${installHint}`));
        return;
      }
      reject(err);
    });

    return promise;
  }

  createLaunchPlan(agent: Agent, options: RunOptions = {}): LaunchPlan {
    return {
      command: agent.command,
      args: this.buildArgs(agent, options),
      env: this.prepareEnv(agent, options),
    };
  }

  private buildArgs(agent: Agent, options: RunOptions): string[] {
    if (agent.buildArgs) return agent.buildArgs(options);
    const args: string[] = [...(agent.args ?? [])];

    // Add model flag if specified; agent may need a provider prefix.
    if (options.model) {
      args.push("--model", (agent.modelPrefix ?? "") + options.model);
    }

    // Add any extra args
    if (options.args) {
      args.push(...options.args);
    }

    return args;
  }
}
