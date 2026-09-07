import { input, password } from "@inquirer/prompts";
import type { Settings } from "../types.js";
import { DEFAULT_MODELS_BASE_URL } from "../types.js";
import { SettingsService } from "./settings.js";
import * as ui from "../ui.js";

/**
 * "Next best step" prerequisite check (forge-login style): before launching
 * an agent, verify the base URL and API key are configured; when missing,
 * show an input row right there instead of failing later.
 *
 *   ? CLI_HOP_BASE_URL = https://api.cli-hop.cc/v1
 *   ? CLI_HOP_API_KEY  = [input is hidden]
 *
 * Newly entered values are persisted to settings so the user is never
 * asked again.
 */

async function askBaseUrl(): Promise<string> {
  const url = await input({
    message: `${ui.envvar("CLI_HOP_BASE_URL")} =`,
    default: DEFAULT_MODELS_BASE_URL,
    validate: (v) => {
      const s = v.trim();
      if (!s) return true; // empty keeps the default
      try {
        new URL(s);
        return true;
      } catch {
        return "Enter a valid URL, e.g. https://api.cli-hop.cc/v1";
      }
    },
  });
  return url.trim() || DEFAULT_MODELS_BASE_URL;
}

async function askApiKey(): Promise<string> {
  ui.muted(`  Don't have a key? Create one at ${ui.url("https://cli-hop.cc/dashboard")}`);
  const key = await password({
    message: `${ui.envvar("CLI_HOP_API_KEY")} =`,
    validate: (v) => (v.trim().length > 0 ? true : "API key cannot be empty"),
  });
  return key.trim();
}

/** Returns settings guaranteed to have both baseUrl and apiKey set. */
export async function ensurePrerequisites(
  settingsService: SettingsService
): Promise<Settings> {
  let settings = await settingsService.load();
  let changed = false;

  if (!settings.baseUrl) {
    ui.info("Base URL is not configured yet.");
    settings = { ...settings, baseUrl: await askBaseUrl() };
    changed = true;
  }

  if (!settings.apiKey) {
    ui.info("API key is not configured yet.");
    settings = { ...settings, apiKey: await askApiKey() };
    changed = true;
  }

  if (changed) {
    await settingsService.save(settings);
    ui.ok(
      settingsService.lastCredentialLocation === "keychain"
        ? "Saved to the OS keychain."
        : `Saved to ${settingsService.filePath}`
    );
  }

  return settings;
}
