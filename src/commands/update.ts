import { Command } from "commander";
import { checkForUpdate, installUpdate, UPDATE_PACKAGE_NAME } from "../services/update.js";
import { sym } from "../ui.js";
import * as ui from "../ui.js";

function noticeLine(current: string, latest: string): string {
  return `Update available: ${ui.dim(current)} ${ui.dim(sym.arrowRight)} ${ui.strong(ui.val(latest))}`;
}

/** `maxplus-ai --update`: check npm and install the latest release. */
export async function performUpdate(): Promise<void> {
  ui.h1("Checking for updates");

  const spinner = new ui.Spinner(`Checking npm for ${UPDATE_PACKAGE_NAME}@latest`);
  const check = await checkForUpdate({ force: true });
  spinner.stop();

  if (check.status === "unknown") {
    ui.warn(`Could not reach the npm registry — ${check.error}`);
    process.exit(1);
  }
  if (check.status === "up-to-date" || !check.latestVersion) {
    ui.ok(`${UPDATE_PACKAGE_NAME} ${check.currentVersion} is up to date`);
    return;
  }

  ui.info(noticeLine(check.currentVersion, check.latestVersion));

  const result = await installUpdate();
  if (!result.ok) {
    ui.danger("Update failed. Try manually:");
    ui.text(`  ${ui.code(`npm install -g ${UPDATE_PACKAGE_NAME}@latest`)}`);
    if (result.output) ui.muted(result.output);
    process.exit(1);
  }

  ui.ok(`Updated to ${check.latestVersion}. Re-run maxplus-ai to use it.`);
}

export const updateCommand = new Command("update")
  .description("Check npm for a newer release and install it")
  .action(async () => {
    try {
      await performUpdate();
    } catch (err) {
      ui.danger(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

/** Max extra wall time the passive check may add to a short command. */
const NOTICE_GRACE_MS = 1_500;

/**
 * Passive startup notice: one network check per 24h (cache file) that prints
 * an "Update available" line just before the process exits, so it never
 * interleaves with spinners, prompts, or agent TUIs. The check gets a brief
 * grace period once the CLI's own work is done, then its socket is released —
 * a slow registry can delay exit by at most NOTICE_GRACE_MS. Silent on any
 * failure and on non-TTY output so CI/logs stay clean (invariant 4).
 */
export function startUpdateNotice(): void {
  if (!process.stdout.isTTY) return;
  if (process.env.MAXPLUS_NO_UPDATE_CHECK === "1") return;

  const abort = new AbortController();
  let line: string | undefined;
  let flushed = false;

  // Release the socket NOTICE_GRACE_MS after startup regardless of outcome:
  // an unref'd in-flight fetch would otherwise hold the loop (and exit) for
  // the full registry timeout on slow networks.
  const giveUp = setTimeout(() => abort.abort(), NOTICE_GRACE_MS);
  giveUp.unref();

  void checkForUpdate({ signal: abort.signal })
    .then((check) => {
      if (check.status === "update-available" && check.latestVersion) {
        line =
          `${noticeLine(check.currentVersion, check.latestVersion)}` +
          ` — run ${ui.code("maxplus-ai --update")}`;
      }
    })
    .catch(() => {
      // The notice must never break the flow.
    })
    .finally(() => {
      clearTimeout(giveUp);
    });

  const flush = () => {
    if (flushed || !line) return;
    flushed = true;
    ui.blank();
    ui.info(line);
  };

  process.once("exit", flush);
}
