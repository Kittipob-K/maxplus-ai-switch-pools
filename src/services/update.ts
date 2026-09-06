import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { VERSION } from "../version.js";
import { writeSecureFile } from "./secure-file.js";

/** Published npm package that provides this CLI. */
export const UPDATE_PACKAGE_NAME = "maxplus-ai-switch-pools";

const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const DEFAULT_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REGISTRY_TIMEOUT_MS = 5_000;
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export type UpdateStatus = "update-available" | "up-to-date" | "unknown";

export interface UpdateCheckResult {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion?: string;
  error?: string;
}

interface UpdateCache {
  lastChecked: string;
  latestVersion: string;
}

function registryBase(): string {
  return (process.env.MAXPLUS_REGISTRY_URL ?? DEFAULT_REGISTRY).replace(/\/+$/, "");
}

/**
 * True when `candidate` is a newer stable release than `current`.
 * Same-core prereleases never trigger the notice (stable > prerelease),
 * and unparseable input compares as "not newer" — never crash the flow.
 */
export function isNewerVersion(current: string, candidate: string): boolean {
  const a = SEMVER.exec(current.trim());
  const b = SEMVER.exec(candidate.trim());
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) {
    const left = Number(a[i]);
    const right = Number(b[i]);
    if (right !== left) return right > left;
  }
  return Boolean(a[4]) && !b[4];
}

/** Fetch the version tagged `latest` for a package from the npm registry. */
export async function fetchLatestVersion(
  packageName: string = UPDATE_PACKAGE_NAME,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch(`${registryBase()}/${packageName}/latest`, {
    signal: signal ?? AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`npm registry returned ${res.status} ${res.statusText}`);
  }
  const body: unknown = await res.json();
  const version =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { version?: unknown }).version
      : undefined;
  if (typeof version !== "string" || !SEMVER.test(version)) {
    throw new Error("npm registry returned an invalid version");
  }
  return version;
}

/** Managed cache file: ${XDG_CONFIG_HOME:-~/.config}/maxplus-ai/update-check.json */
export function updateCachePath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "maxplus-ai", "update-check.json");
}

async function readUpdateCache(): Promise<UpdateCache | undefined> {
  try {
    const cache = JSON.parse(await readFile(updateCachePath(), "utf8")) as
      | Partial<UpdateCache>
      | null;
    if (
      cache &&
      typeof cache.lastChecked === "string" &&
      typeof cache.latestVersion === "string"
    ) {
      return { lastChecked: cache.lastChecked, latestVersion: cache.latestVersion };
    }
  } catch {
    // No cache / unreadable — a fresh check repopulates it.
  }
  return undefined;
}

async function writeUpdateCache(latestVersion: string): Promise<void> {
  const cache: UpdateCache = {
    lastChecked: new Date().toISOString(),
    latestVersion,
  };
  await writeSecureFile(updateCachePath(), `${JSON.stringify(cache, null, 2)}\n`);
}

/**
 * Check npm for a newer release, backed by a 24h cache file so the
 * passive startup check hits the network at most once a day. Never
 * throws — any failure degrades to status "unknown" (invariant 4).
 */
export async function checkForUpdate(
  opts: {
    force?: boolean;
    maxAgeMs?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {}
): Promise<UpdateCheckResult> {
  try {
    const maxAgeMs = opts.maxAgeMs ?? DEFAULT_CHECK_INTERVAL_MS;
    if (!opts.force) {
      const cached = await readUpdateCache();
      const age = cached
        ? Date.now() - Date.parse(cached.lastChecked)
        : Number.POSITIVE_INFINITY;
      if (cached && Number.isFinite(age) && age >= 0 && age < maxAgeMs) {
        return {
          status: isNewerVersion(VERSION, cached.latestVersion)
            ? "update-available"
            : "up-to-date",
          currentVersion: VERSION,
          latestVersion: cached.latestVersion,
        };
      }
    }

    const timeout = AbortSignal.timeout(opts.timeoutMs ?? REGISTRY_TIMEOUT_MS);
    const latestVersion = await fetchLatestVersion(
      UPDATE_PACKAGE_NAME,
      opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
    );
    try {
      await writeUpdateCache(latestVersion);
    } catch {
      // Cache write is best-effort; the check itself still succeeded.
    }
    return {
      status: isNewerVersion(VERSION, latestVersion) ? "update-available" : "up-to-date",
      currentVersion: VERSION,
      latestVersion,
    };
  } catch (err) {
    return {
      status: "unknown",
      currentVersion: VERSION,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface InstallResult {
  ok: boolean;
  output: string;
}

/** Run `npm install -g <pkg>@latest` (spawn without shell — invariant 5). */
export function installUpdate(
  opts: { onProgress?: (msg: string) => void; signal?: AbortSignal } = {}
): Promise<InstallResult> {
  return new Promise((resolve) => {
    const args = ["install", "-g", `${UPDATE_PACKAGE_NAME}@latest`];
    opts.onProgress?.(`npm ${args.join(" ")}`);
    const child = spawn("npm", args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      signal: opts.signal ?? AbortSignal.timeout(INSTALL_TIMEOUT_MS),
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk));
    child.once("error", (err: Error) => {
      resolve({
        ok: false,
        output: output.trim() ? `${output.trim()}\n${err.message}` : err.message,
      });
    });
    child.once("close", (code) => {
      resolve({ ok: code === 0, output: output.trim() });
    });
  });
}
