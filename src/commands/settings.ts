import { Command } from "commander";
import { input, select } from "@inquirer/prompts";
import { SettingsService } from "../services/settings.js";
import { DEFAULT_MODELS_BASE_URL } from "../types.js";
import * as ui from "../ui.js";

/** Prompt for a primary API key. */
async function editApiKey(): Promise<string> {
  const key = await input({
    message: "Enter primary API key:",
    validate: (v) => (v.trim().length === 0 ? "API key cannot be empty" : true),
  });
  return key.trim();
}

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
      { name: "Set / change API key", value: "set-key" },
      { name: "Clear API key", value: "clear-key" },
      { name: "Set / change base URL", value: "set-url" },
      { name: "Back", value: "back" },
    ],
  });

  if (action === "back") return;

  // URL-only edits keep the loaded settings (whose apiKey is the effective
  // one from the Credential Store) and write through save(); key changes go
  // through setApiKey() so the store is updated directly.
  if (action === "set-url") {
    const url = await input({
      message: "Base URL:",
      default: settings.baseUrl ?? DEFAULT_MODELS_BASE_URL,
      validate: (v) => {
        try {
          new URL(v.trim());
          return true;
        } catch {
          return "Enter a valid URL";
        }
      },
    });
    await settingsService.save({ ...settings, baseUrl: url.trim() });
    ui.ok(`Base URL saved: ${url.trim()}`);
    ui.muted(`  ${ui.filepath(settingsService.filePath)}`);
    return;
  }

  if (action === "clear-key") {
    await settingsService.setApiKey(undefined);
    ui.warn("API key cleared.");
    return;
  }

  const key = await editApiKey();
  await settingsService.setApiKey(key);
  ui.ok(`API key saved (${SettingsService.maskKey(key)})`);
  if (settingsService.lastCredentialLocation === "keychain") {
    ui.muted(`  Stored in the OS keychain. If macOS asks about keychain access, choose "Always Allow".`);
  } else {
    ui.muted(`  ${ui.filepath(settingsService.filePath)}`);
  }
  ui.muted(`  Launch each agent once via maxplus-ai to propagate the new key to its config.`);
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
