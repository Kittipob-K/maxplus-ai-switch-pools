import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Remove stale `export VAR=...` / `set -xe VAR ...` lines for the given
 * credential variables from common shell rc files (installer parity with the
 * CLI Hop one-line installers). Returns the files that were modified.
 */
export async function scrubShellRc(
  vars: readonly string[],
  home: string = homedir()
): Promise<string[]> {
  const pattern = vars.join("|");
  const bashLike = new RegExp(`^\\s*(export\\s+)?(${pattern})=`);
  const fishLine = new RegExp(`^\\s*set\\s+-[a-zA-Z]*[xe][a-zA-Z]*\\s+(${pattern})(\\s|$)`);
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
