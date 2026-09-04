import { Command } from "commander";
import { PoolService } from "../services/pool.js";
import { SettingsService } from "../services/settings.js";
import * as ui from "../ui.js";

export const listCommand = new Command("list")
  .description("List available pools and agents (from the MaxPlus API when configured)")
  .option("-l, --local", "Only show built-in local pools, skip the API call")
  .action(async (options) => {
    const poolService = new PoolService();
    const settingsService = new SettingsService();

    let pools = poolService.listPools();
    let source: "remote" | "local" = "local";
    let error: string | undefined;

    if (!options.local) {
      const settings = await settingsService.load();
      const resolved = await poolService.resolvePools({
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
      });
      pools = resolved.pools;
      source = resolved.source;
      error = resolved.error;
    }

    ui.h1(source === "remote" ? "Models (from MaxPlus API)" : "Available Pools (local)");
    if (error) {
      ui.warn(`${error} — showing local pools`);
    }

    for (const pool of pools) {
      ui.text(`  ${ui.strong(ui.val(pool.model))}`);
      ui.dlRow("Name", pool.name, 4);
      ui.dlRow("ID", pool.id, 4);
      ui.dlRow("Agents", pool.agents.map((a) => a.name).join(", "), 4);
      ui.blank();
    }
  });
