import { createRequire } from "node:module";

/**
 * Single source of truth for the CLI version, read from package.json at
 * runtime (npm always ships it) so `--version`, help, and update checks
 * never drift from the installed package version.
 */
const require = createRequire(import.meta.url);

function readPackageVersion(): string {
  try {
    const pkg = require("../package.json") as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readPackageVersion();
