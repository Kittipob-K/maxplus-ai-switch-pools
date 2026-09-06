# maxplus-ai-switch-pools

[![npm version](https://img.shields.io/npm/v/maxplus-ai-switch-pools.svg)](https://www.npmjs.com/package/maxplus-ai-switch-pools)
[![npm downloads](https://img.shields.io/npm/dm/maxplus-ai-switch-pools.svg)](https://www.npmjs.com/package/maxplus-ai-switch-pools)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

CLI for switching AI pools / models and configuring agent CLIs (Claude Code,
Oh My Pi, Pi, Aider, OpenCode, and Codex CLI) to talk to the **MaxPlus AI**
gateway — with one primary API key that works across every agent.

```
$ maxplus-ai
✔ Customize which agents CLI? Claude Code

── Customizing Claude Code ────────────────────────────────────────────
✔ ANTHROPIC_API_KEY=ccsk…26f3 (primary API key)
✔ ANTHROPIC_BASE_URL=https://api.maxplus-ai.cc
✔ 4 models loaded from API
? Select a model/pool:
❯ qwen3.8-flash (qwen3.8-flash)
  glm-5.3-flash (glm-5.3-flash)
  mimo-v2.5 (mimo-v2.5)
```

## Features

- **Interactive by default** — running `maxplus-ai` with no arguments opens the
  "Customize which agents CLI?" menu for all supported CLIs plus Settings.
- **Clean environment per launch** — inherited Anthropic, OpenAI, and MaxPlus
  credentials (including `ANTHROPIC_*`, `OPENAI_*`, and
  `MAXPLUS_API_KEY`) are unset first, so the agent always starts from
  maxplus-ai-managed state.
- **One primary API key for every agent CLI** — the key you save in Settings is
  exported into the env vars each agent reads. Inherited Anthropic, OpenAI, and
  MaxPlus proxy credentials are removed first so only Settings values reach the
  child process.
- **Protocol-aware selection** — models are matched to agents using the gateway's
  advertised `messages`, `chat_completions`, and `responses` capabilities.
  Unsupported model/agent combinations are hidden or rejected before launch.
- **Oh My Pi model sync** — every selection rewrites the `maxplus` provider in
  `~/.omp/agent/models.yml` with the live pool catalogue, choosing
  `anthropic-messages` when a model serves `/v1/messages` and its supported
  wire otherwise; the key itself stays off disk (`MAXPLUS_API_KEY` env).
- **Pi model sync** — every Pi launch merge-writes the live MaxPlus catalogue
  into `~/.pi/agent/models.json` under provider `maxplus`, then starts Pi with
  `--model maxplus/<model>`. Its config stores only `$MAXPLUS_API_KEY`, never
  the primary key itself.
- **OpenCode model sync** — merge-writes provider `maxplus` in
  `~/.config/opencode/opencode.json`: the live `chat_completions` catalogue
  (selected first) plus `baseURL` and `apiKey` are rewritten, while your other
  providers, extra options and any model entries you tuned by hand are
  preserved. The key is referenced as `{env:MAXPLUS_API_KEY}`, never stored. A
  gateway `displayName` overrides an edited label so renames are picked up; a
  retired model is kept and reported as a warning so you can prune it;
  `$schema` is added only when the file is newly created.
- **Codex per-run provider** — launches Codex with `-c` provider overrides for
  the Responses API, leaving the user's `~/.codex/config.toml` untouched.
- **Live model catalogue** — pools are fetched from the MaxPlus API
  (`GET /v1/models`, Bearer auth, cursor pagination). If the API is
  unreachable, falls back to built-in local pools with a warning.
- **Prerequisite prompts (next-best-step)** — if base URL or API key are not
  configured yet, `maxplus-ai` asks for them inline (hidden input for the key)
  and saves them — no need to remember the right command.
- **Claude Code configuration** — mirrors the official MaxPlus installer:
  writes `~/.claude.json` and `~/.claude/settings.json` (endpoint, key, model,
  permissions, onboarding flags, key approval), removes stale credential
  files, and can scrub stale `export ANTHROPIC_*` lines from your shell rc
  files.
- **Update check** — a once-per-day background check against the npm registry
  prints an `Update available` notice (never blocking or crashing the flow);
  run `maxplus-ai --update` to self-update via `npm install -g`. Set
  `MAXPLUS_NO_UPDATE_CHECK=1` to disable the passive check.
- **Semantic CLI output** — consistent ✔/ℹ/!/✖ alerts, headings, aligned
  definition lists, inline markup and a status spinner, with ASCII fallback for
  dumb terminals (see [`src/ui.ts`](src/ui.ts)).

## Requirements

- Node.js **>= 22**
- The agent CLI you want to launch installed and on `PATH`
  (e.g. `claude` from `@anthropic-ai/claude-code`)
- A MaxPlus AI API key — create one at <https://maxplus-ai.cc/dashboard>

## Install

```bash
npm install -g maxplus-ai-switch-pools
```

Or from source:

```bash
git clone https://github.com/Kittipob-K/maxplus-ai-switch-pools.git
cd maxplus-ai-switch-pools
npm install
npm run build
npm test
npm link            # provides the global `maxplus-ai` command
```

## Quick Start

```bash
# Install globally
npm install -g maxplus-ai-switch-pools

# Run interactive setup (will prompt for API key and base URL)
maxplus-ai

# Select your agent CLI (Claude Code, Oh My Pi, Pi, Aider, OpenCode, or Codex)
# Choose a model/pool from the list
# The agent launches automatically with your configuration
```

## Usage

### Interactive mode (recommended)
```bash
maxplus-ai                      # Opens interactive menu to select agent and model
```

### Direct commands
```bash
maxplus-ai customize            # Same as default interactive mode
maxplus-ai settings             # Edit API key / base URL
maxplus-ai list                 # List models from the MaxPlus API
maxplus-ai list --local         # List built-in local pools only
```

### Update the CLI
```bash
maxplus-ai --update             # Check npm and install the latest release
# Alias: maxplus-ai update
```

### Launch specific agent
```bash
maxplus-ai run -a claude-code   # Launch Claude Code
maxplus-ai run -a omp           # Launch Oh My Pi
maxplus-ai run -a pi            # Launch Pi
maxplus-ai run -a aider         # Launch Aider
maxplus-ai run -a opencode      # Launch OpenCode
maxplus-ai run -a codex         # Launch Codex CLI
```

### Advanced options
```bash
maxplus-ai run -p <pool-id>     # Launch with specific pool directly
maxplus-ai run -m <model>       # Override the model
maxplus-ai run -- <args...>     # Pass extra args to the agent CLI
```

### Example workflow
```bash
# First time setup
maxplus-ai
# ✔ Select agent: Claude Code
# ✔ Enter API key: ccsk_... (hidden input)
# ✔ Base URL: https://api.maxplus-ai.cc/v1
# ✔ Select model: qwen3.8-flash
# Claude Code launches automatically!

# Next time - just run and select
maxplus-ai
# Settings already saved, just pick agent and model
```

### The customize flow

1. **Pick agent CLI** — select a supported CLI to configure/launch, or *Settings*.
2. **Unset** inherited credential env vars.
3. **Check prerequisites** — prompts for `ANTHROPIC_BASE_URL` and
   `ANTHROPIC_API_KEY` if not configured, saves them to Settings.
4. **Fetch models** from `GET {baseURL}/models` and pick a pool.
5. **Filter compatibility** using each model's advertised wire protocols.
6. **Write agent config when required** — Claude Code, Oh My Pi, Pi, and
   OpenCode receive merge-safe configuration; Aider and Codex use launch-time
   environment/arguments only.
7. **Launch** the agent with a clean environment.

## Agent compatibility

| Agent | Model selector | Required MaxPlus protocol | Persistent config |
| --- | --- | --- | --- |
| Claude Code | `--model <model>` | `messages` | `~/.claude.json`, `~/.claude/settings.json` |
| Oh My Pi | `--model maxplus/<model>` | any advertised protocol | `~/.omp/agent/models.yml` |
| Pi | `--model maxplus/<model>` | any advertised protocol | `~/.pi/agent/models.json` |
| Aider | `--model openai/<model>` | `chat_completions` | none |
| OpenCode | `--model maxplus/<model>` | `chat_completions` | `~/.config/opencode/opencode.json` |
| Codex CLI | `--model <model>` | `responses` | none; per-run `-c` overrides |

Agent config directories are created with `0700` permissions and managed files
with `0600` permissions. Merge failures are reported instead of overwriting a
malformed existing config.

## Configuration

Settings live at `${XDG_CONFIG_HOME:-~/.config}/maxplus-ai/settings.json`
(created with `0600` permissions, key shown masked everywhere). The primary API
key prefers the OS **keychain** (macOS Keychain, Linux Secret Service, Windows
Credential Manager); the settings file is the fallback home on systems with no
usable keychain (headless, CI) and a key found there migrates to the keychain
automatically. Set `MAXPLUS_DISABLE_KEYCHAIN=1` to force file-only storage:

```json
{
  "baseUrl": "https://api.maxplus-ai.cc/v1"
}
```

| Field     | Purpose                                                              |
| --------- | -------------------------------------------------------------------- |
| `apiKey`  | Primary API key — Bearer token for the models API and exported to every agent CLI. Present in this file only on keychain-less systems; otherwise the key lives in the OS keychain. |
| `baseUrl` | MaxPlus models endpoint including `/v1`; maxplus-ai normalizes it for each agent's protocol. Default: `https://api.maxplus-ai.cc/v1`. |

## Verification

```bash
npm test             # unit, config-security, and isolated CLI E2E tests
npm run typecheck    # strict TypeScript validation
npm pack --dry-run   # verify the publishable package contents
```

## Troubleshooting

- **`⚠ Models API returned 401 … — using local pools`** — the saved key is
  wrong/revoked. Re-create it at <https://maxplus-ai.cc/dashboard> and update
  via `maxplus-ai settings`.
- **`"<model>" isn't described by this version's model catalog …`** — warning
  from Claude Code itself (not from this CLI): the chosen model id is unknown
  to its built-in catalog, so it assumes a 200k window. Update Claude Code,
  append `[1m]` for a 1M window, or set
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS` to the model's real window.
- **No colors/spinner in CI or piped output** — intended: dynamic elements are
  no-ops on non-TTY output, symbols fall back to ASCII on non-UTF-8 terminals.

## License

MIT
