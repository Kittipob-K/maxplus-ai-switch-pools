import { Command } from "commander";
import { confirm, select } from "@inquirer/prompts";
import { AgentService } from "../services/agent.js";
import { PoolService } from "../services/pool.js";
import { SettingsService } from "../services/settings.js";
import { ClaudeConfigService } from "../services/claude-config.js";
import { getAgentById, listAgentOptions } from "../services/registry.js";
import { ensurePrerequisites } from "../services/prereq.js";
import { runSettingsMenu } from "./settings.js";
import type { Pool } from "../types.js";
import { apiKeyEnvVarsFor, baseUrlEnvVarsFor, DEFAULT_MODELS_BASE_URL } from "../types.js";
import * as ui from "../ui.js";

/**
 * Default maxplus-ai flow: pick which agent CLI to customize, clear (unset) its
 * inherited environment, then launch it against a chosen pool.
 */
async function pickAgent(): Promise<string> {
  return select({
    message: "Customize which agents CLI?",
    choices: [
      ...listAgentOptions(),
      { name: "Settings", value: "__settings__" },
    ],
  });
}

async function pickPool(pools: Pool[]): Promise<string> {
  return select({
    message: "Select a model/pool:",
    choices: pools.map((p) => ({ name: `${p.name} (${p.model})`, value: p.id })),
  });
}

export const customizeCommand = new Command("customize")
  .description("Choose an agent CLI to customize and launch it")
  .action(async () => {
    const agentService = new AgentService();
    const poolService = new PoolService();
    const settingsService = new SettingsService();

    try {
      // Main loop: keep offering the menu until the user cancels (Ctrl+C).
      for (;;) {
        const agentId = await pickAgent();

        // "Settings" entry — edit the primary API key, then return to menu.
        if (agentId === "__settings__") {
          await runSettingsMenu();
          console.log();
          continue;
        }

        const agent = getAgentById(agentId);
        if (!agent) {
          ui.danger(`Agent "${agentId}" is not available yet.`);
          process.exit(1);
        }

        ui.h2(`Customizing ${agent.name}`);

        // 1. Unset inherited credentials/proxy env before anything else.
        const removed = agentService.applyUnset(agent);
        if (removed.length > 0) {
          ui.text(`  ${ui.envvar("unset")} ${ui.envvar(removed.join(" "))}`);
        } else {
          ui.muted("  (no env vars to unset)");
        }

        // 2. Check BASE_URL and API_KEY: prompt for missing values now
        //    ("next best step" — same idea as forge login prerequisites).
        const settings = await ensurePrerequisites(settingsService);
        const endpoint = ClaudeConfigService.endpointFromBaseUrl(
          settings.baseUrl ?? DEFAULT_MODELS_BASE_URL
        );
        const keyVars = apiKeyEnvVarsFor(agent);
        const urlVars = baseUrlEnvVarsFor(agent);
        if (keyVars.length > 0) {
          ui.ok(
            `${ui.envvar(keyVars[0] + "=")}${ui.val(SettingsService.maskKey(settings.apiKey!))} ${ui.dim("(primary API key)")}`
          );
        } else {
          ui.muted(
            `  (${agent.name} does not read the API key from env — skipping)`
          );
        }
        if (urlVars.length > 0) {
          ui.ok(`${ui.envvar(urlVars[0] + "=")}${ui.url(endpoint)}`);
        }

        // 3. Pull the model list from the MaxPlus API and let the user choose.
        const spinner = new ui.Spinner("Fetching models from MaxPlus API");
        const { pools, source, error } = await poolService.resolvePools({
          apiKey: settings.apiKey,
          baseUrl: settings.baseUrl,
        });
        spinner.stop();
        if (source === "local" && error) {
          ui.warn(`${error} — using local pools`);
        } else if (source === "local" && !settings.apiKey) {
          ui.warn("No API key set — using local pools (set one in Settings)");
        } else if (source === "remote") {
          ui.ok(`${pools.length} models loaded from API`);
        }

        const poolId = await pickPool(pools);
        const pool = pools.find((p) => p.id === poolId);
        if (!pool) {
          ui.danger(`Pool "${poolId}" not found`);
          process.exit(1);
        }

        // 4. For Claude Code, persist the MaxPlus configuration the same way
        //    the official installer does (~/.claude.json + ~/.claude/settings.json).
        if (agent.type === "claude-code" && settings.apiKey) {
          const claudeConfig = new ClaudeConfigService();
          ui.info(
            `Configuring Claude Code → ${ui.url(endpoint)} (${ui.val(pool.model)})`
          );
          const changed = await claudeConfig.apply({
            apiKey: settings.apiKey,
            endpoint,
            model: pool.model,
          });
          for (const c of changed) ui.ok(ui.filepath(c));

          if (
            await confirm({
              message: "Remove stale Claude exports from your shell rc files?",
              default: false,
            })
          ) {
            const touched = await claudeConfig.scrubShellRc();
            touched.length > 0
              ? ui.ok(`scrubbed ${touched.map(ui.filepath).join(", ")}`)
              : ui.muted("  (no stale exports found)");
          }
        }

        ui.h2(`🚀 Starting ${agent.name} with model ${pool.model}`);
        const exitCode = await agentService.run(agent, {
          pool: poolId,
          model: pool.model,
          agent: agent.type,
          apiKey: settings.apiKey,
          baseUrl: settings.apiKey ? endpoint : undefined,
        });
        process.exit(exitCode);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "ExitPromptError") {
        process.exit(0);
      }
      ui.danger(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
