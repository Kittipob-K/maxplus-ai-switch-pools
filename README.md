# maxplus-ai-switch-pools

CLI for switching AI pools / models and configuring agent CLIs (Claude Code,
Oh My Pi) to talk to the **MaxPlus AI** gateway — with one primary API key that
works across every agent.

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
  "Customize which agents CLI?" menu (Claude Code, Oh My Pi, plus Settings).
- **Clean environment per launch** — inherited Anthropic/proxy credentials
  (`ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
  `ANTHROPIC_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`) are unset first, so the agent
  always starts from maxplus-ai-managed state.
- **One primary API key for every agent CLI** — the key you save in Settings is
  exported into the env vars each agent type reads (`ANTHROPIC_API_KEY` for
  Claude Code, `OPENAI_API_KEY` for OpenAI CLIs, …). New agents added to the
  registry inherit this automatically.
- **Oh My Pi model sync** — every selection rewrites the `maxplus` provider in
  `~/.omp/agent/models.yml` with the live pool catalogue, choosing
  `anthropic-messages` when a model serves `/v1/messages` and its supported
  wire otherwise; the key itself stays off disk (`MAXPLUS_API_KEY` env).
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
git clone <repo-url> && cd maxplus-ai-switch-pools
npm install
npm run build
npm link            # provides the global `maxplus-ai` command
```

## Usage

```bash
maxplus-ai                      # interactive customize flow (default)
maxplus-ai customize            # same as above
maxplus-ai settings             # edit API key / base URL
maxplus-ai list                 # list models from the MaxPlus API
maxplus-ai list --local         # list built-in local pools only
maxplus-ai run -p <pool-id>     # launch an agent against a pool directly
maxplus-ai run -a omp           # choose the agent CLI (claude-code, omp)
maxplus-ai run -m <model>       # override the model
maxplus-ai run -- <args...>     # pass extra args to the agent CLI
```

### The customize flow

1. **Pick agent CLI** — *Claude Code* to configure/launch, or *Settings*.
2. **Unset** inherited credential env vars.
3. **Check prerequisites** — prompts for `ANTHROPIC_BASE_URL` and
   `ANTHROPIC_API_KEY` if not configured, saves them to Settings.
4. **Fetch models** from `GET {baseURL}/models` and pick a pool.
5. **Write Claude Code config** (`~/.claude.json`, `~/.claude/settings.json`),
   optionally scrub stale shell rc exports.
6. **Launch** the agent with a clean environment: `claude --model <pool>`.

## Configuration

Settings live at `${XDG_CONFIG_HOME:-~/.config}/maxplus-ai/settings.json`
(created with `0600` permissions, key shown masked everywhere):

```json
{
  "apiKey": "ccsk-…",
  "baseUrl": "https://api.maxplus-ai.cc/v1"
}
```

| Field     | Purpose                                                              |
| --------- | -------------------------------------------------------------------- |
| `apiKey`  | Primary API key — Bearer token for the models API and exported to every agent CLI. |
| `baseUrl` | MaxPlus base URL including `/v1`; the `/v1` suffix is stripped for `ANTHROPIC_BASE_URL`. Default: `https://api.maxplus-ai.cc/v1`. |

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
