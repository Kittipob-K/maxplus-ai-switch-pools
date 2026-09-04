import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Settings } from "../types.js";
import { writeSecureFile } from "./secure-file.js";

/**
 * Persists user settings (primary API key, etc.) as JSON in
 * ${XDG_CONFIG_HOME:-~/.config}/maxplus-ai/settings.json with 0600
 * permissions so the key is only readable by the current user.
 */
export class SettingsService {
  readonly filePath: string;

  constructor(filePath?: string) {
    const base =
      process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
    this.filePath = filePath ?? join(base, "maxplus-ai", "settings.json");
  }

  async load(): Promise<Settings> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as Settings;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    }
  }

  async save(settings: Settings): Promise<void> {
    await writeSecureFile(
      this.filePath,
      `${JSON.stringify(settings, null, 2)}\n`
    );
  }

  /** Show the key with only the last 4 chars visible, e.g. "sk-...abcd". */
  static maskKey(key: string): string {
    if (key.length <= 4) return "****";
    return `${key.slice(0, 4)}…${key.slice(-4)}`;
  }
}
