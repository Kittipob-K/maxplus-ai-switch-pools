import { readFile, writeFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { endpointFromModelsBaseUrl } from "./endpoint.js";
import { writeSecureFile } from "./secure-file.js";
import { readJsonDocument } from "./config-document.js";

/**
 * Configures Claude Code the same way the CLI Hop one-line installer does:
 * writes ~/.claude.json and ~/.claude/settings.json so the `claude` CLI
 * talks to the CLI Hop endpoint with the user's key — no onboarding,
 * no stale OAuth credentials, key pre-approved.
 */
export interface ClaudeConfigInput {
  /** Primary API key (ccsk-...). */
  apiKey: string;
  /** Endpoint root WITHOUT the /v1 suffix, e.g. https://api.cli-hop.cc */
  endpoint: string;
  /** Model id to configure, e.g. claude-opus-4-8. */
  model: string;
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return (await readJsonDocument(file, {
    invalidMessage: (path) => `${path} is not valid JSON - fix it before switching pools`,
  })).value;
}

async function writeJson(
  file: string,
  data: unknown,
  secureParent: boolean
): Promise<void> {
  await writeSecureFile(file, `${JSON.stringify(data, null, 2)}\n`, { secureParent });
}

/** Approve the key's last-20-char tail so claude does not prompt about it. */
function approveKeyTail(
  state: Record<string, unknown>,
  apiKey: string
): Record<string, unknown> {
  const tail = apiKey.slice(-20);
  const old = (state.customApiKeyResponses ?? {}) as Record<string, unknown>;
  const approved = Array.isArray(old.approved) ? [...(old.approved as string[])] : [];
  const rejected = Array.isArray(old.rejected) ? [...(old.rejected as string[])] : [];
  if (!approved.includes(tail)) approved.push(tail);
  return { ...state, customApiKeyResponses: { approved, rejected } };
}

export class ClaudeConfigService {
  readonly claudeJsonPath: string;
  readonly settingsPath: string;

  constructor(paths?: { claudeJsonPath: string; settingsPath: string }) {
    const home = homedir();
    this.claudeJsonPath = paths?.claudeJsonPath ?? join(home, ".claude.json");
    this.settingsPath = paths?.settingsPath ?? join(home, ".claude", "settings.json");
  }

  /** Derive the Claude base URL from a models baseUrl (strip /v1). */
  static endpointFromBaseUrl(baseUrl: string): string {
    return endpointFromModelsBaseUrl(baseUrl);
  }

  async apply(input: ClaudeConfigInput): Promise<string[]> {
    const changed: string[] = [];
    const { apiKey, endpoint, model } = input;

    // 1. ~/.claude.json — onboarding flags + key approval (installer parity).
    const state = approveKeyTail(await readJson(this.claudeJsonPath), apiKey);
    state.hasCompletedOnboarding = true;
    state.bypassPermissionsModeAccepted = true;
    await writeJson(this.claudeJsonPath, state, false);
    changed.push(this.claudeJsonPath);

    // 2. ~/.claude/settings.json — env, model, permissions (installer parity).
    const settings = approveKeyTail(await readJson(this.settingsPath), apiKey);
    settings.hasCompletedOnboarding = true;
    if (settings.cleanupPeriodDays == null) settings.cleanupPeriodDays = 30;

    const env = (settings.env ?? {}) as Record<string, string>;
    env.ANTHROPIC_BASE_URL = endpoint;
    env.ANTHROPIC_API_KEY = apiKey;
    env.CLAUDE_CODE_ATTRIBUTION_HEADER = "0";
    delete env.ANTHROPIC_AUTH_TOKEN;
    settings.env = env;

    if (!settings.permissions) {
      settings.permissions = {
        allow: [
          "Edit", "Read", "Write", "Bash", "Agent", "Glob", "Grep",
          "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop",
          "WebSearch", "WebFetch", "NotebookEdit", "Skill",
          "AskUserQuestion", "EnterPlanMode", "ExitPlanMode",
        ],
        deny: [],
        ask: [],
        defaultMode: "bypassPermissions",
      };
    }
    if (!settings.model) settings.model = model;

    await writeJson(this.settingsPath, settings, true);
    changed.push(this.settingsPath);

    // 3. Remove stale OAuth/credential files so the API key takes over.
    for (const stale of [
      join(homedir(), ".claude", ".credentials.json"),
      join(homedir(), ".claude", "auth.json"),
    ]) {
      try {
        await unlink(stale);
        changed.push(`removed ${stale}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }

    return changed;
  }

  /**
   * Remove stale `export VAR=...` / `set -xe VAR ...` lines for the Claude
   * credential vars from common shell rc files (installer parity).
   * Returns the files that were modified.
   */
  static readonly SCRUB_VARS = [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
  ];

  async scrubShellRc(): Promise<string[]> {
    const vars = ClaudeConfigService.SCRUB_VARS.join("|");
    const bashLike = new RegExp(
      `^\\s*(export\\s+)?(${vars})=`
    );
    const fishLine = new RegExp(
      `^\\s*set\\s+-[a-zA-Z]*[xe][a-zA-Z]*\\s+(${vars})(\\s|$)`
    );
    const home = homedir();
    const rcFiles = [
      join(home, ".zshrc"),
      join(home, ".zprofile"),
      join(home, ".bashrc"),
      join(home, ".bash_profile"),
      join(home, ".profile"),
      join(home, ".config", "fish", "config.fish"),
    ];
    const touched: string[] = [];

    for (const rc of rcFiles) {
      let raw: string;
      try {
        raw = await readFile(rc, "utf8");
      } catch {
        continue;
      }
      const kept = raw
        .split("\n")
        .filter((line) => !bashLike.test(line) && !fishLine.test(line))
        .join("\n");
      if (kept !== raw) {
        await writeFile(rc, kept, "utf8");
        touched.push(rc);
      }
    }
    return touched;
  }
}
