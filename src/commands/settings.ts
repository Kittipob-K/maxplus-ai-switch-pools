import { Command } from "commander";
import { confirm, input, password } from "@inquirer/prompts";
import { SettingsService } from "../services/settings.js";
import { DEFAULT_MODELS_BASE_URL } from "../types.js";
import { sectionTabs, type SectionMenuAction } from "../prompts/section-tabs.js";
import * as ui from "../ui.js";

export type SettingsMenuResult = "back";

export async function handleSettingsAction(
  action: Exclude<SectionMenuAction, { type: "agent" } | { type: "back" }>,
  settingsService: SettingsService
): Promise<SettingsMenuResult> {
  const settings = await settingsService.load();

  if (action.type === "apiKey") {
    const apiKey = await password({
      message: `${ui.envvar("MAXPLUS_API_KEY")} =`,
      validate: (value) => value.trim() ? true : "API key cannot be empty",
    });
    await settingsService.setApiKey(apiKey.trim());
    ui.ok(settingsService.lastCredentialLocation === "keychain"
      ? "API key saved to the OS keychain."
      : `API key saved to ${settingsService.filePath}`);
    return "back";
  }

  if (action.type === "baseUrl") {
    const baseUrl = await input({
      message: `${ui.envvar("MAXPLUS_BASE_URL")} =`,
      default: settings.baseUrl ?? DEFAULT_MODELS_BASE_URL,
      validate: (value) => {
        try { new URL(value.trim()); return true; }
        catch { return "Enter a valid URL, e.g. https://api.maxplus-ai.cc/v1"; }
      },
    });
    await settingsService.save({ ...settings, baseUrl: baseUrl.trim() });
    ui.ok(`Base URL saved to ${settingsService.filePath}`);
    return "back";
  }

  const shouldReset = await confirm({
    message: "Clear the API key and Base URL?",
    default: false,
  });
  if (!shouldReset) return "back";

  // Keep lastAgentId: credential reset should not erase the user's menu history.
  await settingsService.setApiKey(undefined);
  await settingsService.save({ lastAgentId: settings.lastAgentId });
  ui.warn("API key and Base URL cleared.");
  return "back";
}

/** Interactive settings menu — also exposed as `maxplus-ai settings`. */
export async function runSettingsMenu(): Promise<SettingsMenuResult> {
  const settingsService = new SettingsService();
  for (;;) {
    const settings = await settingsService.load();
    const action = await sectionTabs({
      agents: [],
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      settingsOnly: true,
    });
    if (action.type === "back") return "back";
    if (action.type === "agent") continue;
    await handleSettingsAction(action, settingsService);
  }
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
