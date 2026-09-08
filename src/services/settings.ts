import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Settings } from "../types.js";
import { openKeychain, type Keychain } from "./keychain.js";
import { writeSecureFile } from "./secure-file.js";

/**
 * The Credential Store (ADR 0001): non-secret settings live in
 * ${XDG_CONFIG_HOME:-~/.config}/cli-hop/settings.json (0600), while the
 * Primary API Key lives in the OS keychain when one is usable and in that
 * file otherwise.
 *
 * - load() returns the effective key: the keychain wins; a key still found in
 *   the file while the keychain is empty is migrated in on first read.
 * - setApiKey() writes the key to the keychain (removing any plaintext copy);
 *   with no keychain it stores the key in the file.
 * - save() persists non-secret settings, writing the file WITHOUT the apiKey
 *   whenever a keychain is in play, so the file never becomes a second home
 *   for the key on keychain-capable systems.
 */
export class SettingsService {
  readonly filePath: string;
  /** Where the last setApiKey()/save() put the key, for honest messaging. */
  lastCredentialLocation: "keychain" | "file" | "none" = "none";

  /** undefined = not probed yet; null = no usable keychain. */
  #keychain: Keychain | null | undefined = undefined;

  constructor(
    filePath?: string,
    options?: { keychain?: Keychain | null }
  ) {
    const base =
      process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
    this.filePath = filePath ?? join(base, "cli-hop", "settings.json");
    if (options && "keychain" in options) this.#keychain = options.keychain;
  }

  #resolveKeychain(): Keychain | null {
    // `null` is an explicit file-only choice; only an unresolved `undefined`
    // should trigger probing the OS keychain.
    if (this.#keychain !== undefined) return this.#keychain;
    this.#keychain = openKeychain();
    return this.#keychain;
  }

  async #readFile(): Promise<Settings> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as Settings;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    }
  }

  async #writeFile(settings: Settings): Promise<void> {
    await writeSecureFile(
      this.filePath,
      `${JSON.stringify(settings, null, 2)}\n`
    );
  }

  async load(): Promise<Settings> {
    const file = await this.#readFile();
    const keychain = this.#resolveKeychain();
    if (!keychain) return file;

    let stored: string | null;
    try {
      stored = keychain.getPassword();
    } catch {
      // Keychain exists but is unreadable right now (macOS access prompt
      // declined, locked wallet). Degrade to the file rather than
      // dead-ending the launch flow; the file copy survives until a
      // migration succeeds, so a key is never lost to this path.
      return file;
    }
    if (stored) return { ...file, apiKey: stored };

    if (file.apiKey) {
      // One-time auto-migration: keychain empty, file holds the key.
      try {
        keychain.setPassword(file.apiKey);
      } catch {
        return file;
      }
      const { apiKey: _migrated, ...rest } = file;
      await this.#writeFile(rest);
    }
    return file;
  }

  /** Persist a new Primary API Key (undefined clears it from both locations). */
  async setApiKey(key?: string): Promise<void> {
    const keychain = this.#resolveKeychain();
    const file = await this.#readFile();
    const { apiKey: _dropped, ...rest } = file;
    if (keychain) {
      try {
        if (key) keychain.setPassword(key);
        else keychain.deletePassword();
        await this.#writeFile(rest);
        this.lastCredentialLocation = key ? "keychain" : "none";
        return;
      } catch {
        // Keychain write failed — keep the key in the file so it is never
        // lost to an environment issue.
      }
    }
    await this.#writeFile(key ? { ...rest, apiKey: key } : rest);
    this.lastCredentialLocation = key ? "file" : "none";
  }

  async save(settings: Settings): Promise<void> {
    const { apiKey, ...rest } = settings;
    const keychain = this.#resolveKeychain();
    if (!keychain) {
      await this.#writeFile(apiKey ? { ...rest, apiKey } : rest);
      if (apiKey) this.lastCredentialLocation = "file";
      return;
    }
    if (apiKey) {
      try {
        keychain.setPassword(apiKey);
        this.lastCredentialLocation = "keychain";
      } catch {
        // Keychain write failed — keep the key in the file instead.
        await this.#writeFile({ ...rest, apiKey });
        this.lastCredentialLocation = "file";
        return;
      }
    }
    // A save without a key NEVER deletes an existing keychain item — that is
    // setApiKey(undefined)'s job, so a transient keychain read failure can
    // never wipe the user's key through an ordinary settings write.
    await this.#writeFile(rest);
  }

  /** Show the key with only the last 4 chars visible, e.g. "sk-...abcd". */
  static maskKey(key: string): string {
    if (key.length <= 4) return "****";
    return `${key.slice(0, 4)}…${key.slice(-4)}`;
  }
}
