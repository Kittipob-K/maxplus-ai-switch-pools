import { Command } from "commander";
import { select } from "@inquirer/prompts";
import { SettingsService } from "../services/settings.js";
import { DEFAULT_MODELS_BASE_URL } from "../types.js";
import * as ui from "../ui.js";

/** Interactive settings menu — also exposed as `maxplus-ai settings`. */
export async function runSettingsMenu(): Promise<void> {
  const settingsService = new SettingsService();
  const settings = await settingsService.load();

  const current = settings.apiKey
    ? ui.val(SettingsService.maskKey(settings.apiKey))
    : ui.dim("(not set)");
  const currentUrl = settings.baseUrl
    ? ui.url(settings.baseUrl)
    : ui.dim(`(default ${DEFAULT_MODELS_BASE_URL})`);

  const action = await select({
    message: `Settings — API key: ${current} · Base URL: ${currentUrl}`,
    choices: [
      { name: "Reset (clear API key and base URL)", value: "reset" },
      { name: "Back", value: "back" },
    ],
  });

  if (action === "back") return;

  // Reset: clear both key and URL, forcing the next customize run to prompt again.
  await settingsService.setApiKey(undefined);
  await settingsService.save({});
  ui.warn("API key and base URL cleared. You will be prompted again on next customize.");
}

export const settingsCommand = new Command("settings")
  .description("Configure maxplus-ai settings, e.g. the primary API key")
  .action(async () => {
    try {
      await runSettingsMenu();
    } catch (err) {
      if (err instanceof Error && err.name === "ExitPromptError") {
        process.exit(0);
      }
      ui.danger(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
