import { Command } from "commander";
import { confirm, select } from "@inquirer/prompts";
import { AgentService } from "../services/agent.js";
import { PoolService } from "../services/pool.js";
import { SettingsService } from "../services/settings.js";
import { endpointFromModelsBaseUrl } from "../services/endpoint.js";
import { getAgentById, listAgentOptions } from "../services/registry.js";
import { ensureAgentInstalled } from "../services/installer.js";
import { ensurePrerequisites } from "../services/prereq.js";
import { sectionTabs } from "../prompts/section-tabs.js";
import type { Pool } from "../types.js";
import { apiKeyEnvVarsFor, baseUrlEnvVarsFor, DEFAULT_MODELS_BASE_URL } from "../types.js";
import * as ui from "../ui.js";

/**
 * Default maxplus-ai flow: choose an AGENTS or SETTINGS section, then pick an
 * agent to customize, clear (unset) inherited environment, and launch it.
 */
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
      // Show logo before anything else.
      ui.logo();

      // Main loop: the tab and its list share one screen. Switching tabs
      // immediately replaces the list; Enter activates its highlighted item.
      let initialSection: "agents" | "settings" = "agents";
      for (;;) {
        const savedSettings = await settingsService.load();
        const action = await sectionTabs({
          agents: listAgentOptions(savedSettings.lastAgentId),
          apiKey: savedSettings.apiKey,
          baseUrl: savedSettings.baseUrl,
          initialSection,
        });

        if (action.type === "back") return;

        if (action.type !== "agent") {
          // Settings actions are handled by the settings command's shared menu.
          // Import lazily to avoid a module cycle with this default flow.
          const { handleSettingsAction } = await import("./settings.js");
          await handleSettingsAction(action, settingsService);
          initialSection = "settings";
          console.log();
          continue;
        }
        initialSection = "agents";

        // Defer this until AGENTS is selected. This lets a user enter Settings
        // without first being forced through the credentials prompt.
        const settings = await ensurePrerequisites(settingsService);

        const agent = getAgentById(action.id);
        if (!agent) {
          ui.danger(`Agent "${action.id}" is not available yet.`);
          process.exit(1);
        }

        ui.h2(`Customizing ${agent.name}`);

        // 0. Install check (next-best-step): offer the official installer
        // when the CLI is missing; without it the later spawn would ENOENT.
        if (!(await ensureAgentInstalled(agent))) continue;

        // 1. Unset inherited credentials/proxy env before anything else.
        const removed = agentService.applyUnset(agent);
        if (removed.length > 0) {
          ui.text(`  ${ui.envvar("unset")} ${ui.envvar(removed.join(" "))}`);
        } else {
          ui.muted("  (no env vars to unset)");
        }

        // 2. Inject the primary API key and base URL into the agent's environment.
        const endpoint = endpointFromModelsBaseUrl(
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
        const { pools, source, error, models } = await poolService.resolvePools({
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

        const compatiblePools = pools.filter((pool) =>
          pool.agents.some((candidate) => candidate.id === agent.id)
        );
        if (compatiblePools.length === 0) {
          ui.danger(`No available MaxPlus models support ${agent.name}.`);
          continue;
        }
        const poolId = await pickPool(compatiblePools);
        const pool = compatiblePools.find((p) => p.id === poolId);
        if (!pool) {
          ui.danger(`Pool "${poolId}" not found`);
          process.exit(1);
        }

        ui.info(
          `Configuring ${agent.name} → ${ui.url(endpoint)} (${ui.val(pool.model)})`
        );
        const changed = await agentService.prepare(agent, {
          apiKey: settings.apiKey!,
          endpoint,
          models: models ?? [{ id: pool.model }],
          selected: pool.model,
        });
        for (const file of changed) ui.ok(ui.filepath(file));

        if (agent.scrubShellConfig && await confirm({
          message: `Remove stale ${agent.name} exports from your shell rc files?`,
          default: false,
        })) {
          const touched = await agentService.scrubShellConfig(agent);
          touched.length > 0
            ? ui.ok(`scrubbed ${touched.map(ui.filepath).join(", ")}`)
            : ui.muted("  (no stale exports found)");
        }

        ui.h2(`🚀 Starting ${agent.name} with model ${pool.model}`);
        await settingsService.save({ ...settings, lastAgentId: agent.id });
        const exitCode = await agentService.run(agent, {
          pool: poolId,
          model: pool.model,
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
