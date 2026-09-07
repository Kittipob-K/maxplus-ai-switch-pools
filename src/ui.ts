import chalk from "chalk";

/**
 * Semantic CLI output primitives inspired by r-lib's "cli" package
 * (https://cli.r-lib.org/articles/semantic-cli.html).
 *
 * Instead of sprinkling raw colors through command code, output is built
 * from semantic elements — alerts, headings, rules, lists, inline markup
 * and spinners — each styled consistently here, like HTML vs CSS.
 * All symbols degrade to ASCII when the terminal lacks UTF-8 support,
 * and dynamic elements (spinner) no-op when output is not a TTY (CI/logs).
 */

const USE_UTF8 =
  process.platform !== "win32" ||
  !!(process.env.WT_SESSION || process.env.MSYSTEM) ||
  /UTF-?8/i.test(
    process.env.LC_ALL ?? process.env.LC_CTYPE ?? process.env.LANG ?? ""
  );

/** Unicode symbols with ASCII fallback (cf. r-lib cli `symbol`, figures). */
export const sym = {
  tick: USE_UTF8 ? "✔" : "v",
  cross: USE_UTF8 ? "✖" : "x",
  warning: "!",
  info: USE_UTF8 ? "ℹ" : "i",
  arrowRight: USE_UTF8 ? "→" : "->",
  pointer: USE_UTF8 ? "❯" : ">",
  bullet: USE_UTF8 ? "•" : "*",
  line: USE_UTF8 ? "─" : "-",
  ellipsis: USE_UTF8 ? "…" : "...",
};

/** Current terminal width (default 80 when unknown). */
export function consoleWidth(): number {
  const cols = process.stdout.columns;
  return cols && cols > 0 ? cols : 80;
}

/** True when dynamic in-place output (\\r) is supported. */
export function isDynamic(): boolean {
  return !!process.stdout.isTTY && !process.env.CI;
}

function writeLine(s = ""): void {
  process.stdout.write(s + "\n");
}

// ---------------------------------------------------------------- alerts

export function ok(message: string): void {
  writeLine(`${chalk.green.bold(sym.tick)} ${chalk.green(message)}`);
}

export function info(message: string): void {
  writeLine(`${chalk.cyan.bold(sym.info)} ${message}`);
}

export function warn(message: string): void {
  writeLine(`${chalk.yellow.bold(sym.warning)} ${chalk.yellow(message)}`);
}

export function danger(message: string): void {
  process.stderr.write(
    `${chalk.red.bold(sym.cross)} ${chalk.red(message)}\n`
  );
}

/** A quiet gray note without a status symbol. */
export function muted(message: string): void {
  writeLine(chalk.gray(message));
}

// -------------------------------------------------------------- headings

function padded(label: string, color: (s: string) => string): string {
  const plain = `${sym.line.repeat(2)} ${label} `;
  const rest = Math.max(0, consoleWidth() - [...plain].length);
  return color(plain + sym.line.repeat(rest));
}

export function h1(title: string): void {
  writeLine();
  writeLine(padded(title, (s) => chalk.cyan(s)));
  writeLine();
}

export function h2(title: string): void {
  writeLine();
  writeLine(padded(title, (s) => chalk.cyan.bold(s)));
}

export function h3(title: string): void {
  writeLine();
  writeLine(`${sym.line.repeat(2)} ${chalk.cyan.bold(title)}`);
}

/** Format a compact, terminal-friendly tab bar for top-level sections. */
export function tabBar(active: "agents" | "settings"): string {
  const tab = (label: string, selected: boolean): string =>
    selected ? chalk.cyan.bold(`[ ${label} ]`) : chalk.gray(`  ${label}  `);

  return `${tab("AGENTS", active === "agents")}  ${tab("SETTINGS", active === "settings")}`;
}

/** Render the top-level tab bar outside an interactive prompt. */
export function tabs(active: "agents" | "settings"): void {
  writeLine(tabBar(active));
}

// ------------------------------------------------------------------ rules

export function rule(label?: string): void {
  writeLine(label ? padded(label, (s) => chalk.cyan(s)) : padded("", (s) => chalk.cyan(s)));
}

// ----------------------------------------------------------------- lists

export function li(text: string, indent = 2): void {
  writeLine(`${" ".repeat(indent)}${sym.bullet} ${text}`);
}

/** Definition-list row: term padded so values align in a column. */
export function dlRow(term: string, value: string, indent = 2): void {
  const label = `${term}:`;
  writeLine(
    `${" ".repeat(indent)}${chalk.bold(label.padEnd(9))}  ${value}`
  );
}

export function blank(): void {
  writeLine();
}

export function text(s = ""): void {
  writeLine(s);
}

// --------------------------------------------------------- inline markup
// (the `.code`, `.envvar`, `.file`, `.url` styles of r-lib cli)

export function code(s: string): string {
  return chalk.bold(s);
}

export function envvar(s: string): string {
  return chalk.yellow(s);
}

export function filepath(s: string): string {
  return chalk.underline(s);
}

export function url(s: string): string {
  return chalk.blue.underline(s);
}

export function dim(s: string): string {
  return chalk.gray(s);
}

export function strong(s: string): string {
  return chalk.bold(s);
}

export function val(s: string): string {
  return chalk.cyan(s);
}

// ----------------------------------------------------------------- logo

export function logo(): void {
  // Keep the source spacing verbatim: the first row is intentionally indented.
  const art = [
    " ▄▄▄▄▄▄▄ ▄▄▄      ▄▄▄▄▄      ▄▄▄   ▄▄▄   ▄▄▄▄▄   ▄▄▄▄▄▄▄",
    "███▀▀▀▀▀ ███       ███       ███   ███ ▄███████▄ ███▀▀███▄",
    "███      ███       ███       █████████ ███   ███ ███▄▄███▀",
    "███      ███       ███ ▀▀▀▀▀ ███▀▀▀███ ███▄▄▄███ ███▀▀▀▀",
    "▀███████ ████████ ▄███▄      ███   ███  ▀█████▀  ███",
  ].join("\n");

  const logoWidth = 68;
  const width = consoleWidth();

  // Hide logo if terminal is too narrow.
  if (width < logoWidth) {
    writeLine(chalk.cyan.bold("CLI_HOP-AI"));
    writeLine();
    return;
  }

  writeLine(chalk.cyan(art));
  writeLine();
}

// --------------------------------------------------------------- spinner

const SPIN_FRAMES_UTF8 = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"; // r-lib "dots"
const SPIN_FRAMES_ASCII = "|/-\\";

/**
 * Single-line status spinner, like `cli_status()` in r-lib cli.
 * Non-dynamic terminals get a single static line instead of animation.
 */
export class Spinner {
  #i = 0;
  #timer: NodeJS.Timeout | undefined;
  #text: string;

  constructor(text: string) {
    this.#text = text;
    if (isDynamic()) {
      this.#render();
      this.#timer = setInterval(() => {
        this.#i = (this.#i + 1) % this.frames().length;
        this.#render();
      }, 80);
    } else {
      writeLine(`${sym.ellipsis} ${text}`);
    }
  }

  update(text: string): void {
    this.#text = text;
    if (this.#timer) this.#render();
  }

  /** Stop animating and clear the status line. */
  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    if (isDynamic()) process.stdout.write("\r\x1b[K");
  }

  private frames(): string {
    return USE_UTF8 ? SPIN_FRAMES_UTF8 : SPIN_FRAMES_ASCII;
  }

  #render(): void {
    const frame = this.frames()[this.#i];
    process.stdout.write(`\r${chalk.cyan(frame)} ${this.#text}\x1b[K`);
  }
}
