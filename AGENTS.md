# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this project is

`maxplus-ai-switch-pools` is a TypeScript ESM CLI (binary: **`maxplus-ai`**) that
switches AI pools/models and configures agent CLIs (currently Claude Code) to
use the MaxPlus AI gateway with one primary API key. See `README.md` for
user-facing docs.

## Commands

```bash
npm run build        # tsc -> dist/ (ESM)
npx tsc --noEmit     # typecheck only
npm run dev          # run via tsx without building
node dist/index.js   # built CLI; `maxplus-ai` = npm link global
```

- Node.js **>= 22** required (`Promise.withResolvers` is used).
- No test framework is configured yet — verify changes by building and running
  the CLI manually (see Testing below).

## Architecture

```
src/
  index.ts              commander program; no-args entry -> customize flow
  types.ts              shared types + per-type env var maps + defaults
  ui.ts                 semantic CLI output primitives (r-lib cli style)
  commands/
    customize.ts        default interactive flow (pick agent -> fetch models -> launch)
    settings.ts         Settings menu (API key / base URL) + `maxplus-ai settings`
    run.ts              non-interactive launch: maxplus-ai run [-p pool] [-m model] [-- args]
    list.ts             model list (remote, --local fallback)
  services/
    settings.ts         SettingsService: read/write ~/.config/maxplus-ai/settings.json
    prereq.ts           ensurePrerequisites(): inline prompts for missing baseUrl/apiKey
    pool.ts             PoolService: local pools + MaxPlus /models API (Bearer, pagination)
    agent.ts            AgentService: unset env, export key+base URL, spawn agent
    claude-config.ts    installer-parity writes of ~/.claude.json + ~/.claude/settings.json
    omp-config.ts       merge-write ~/.omp/agent/models.yml (per-model wire api
                        from MaxPlus /models capabilities)
    registry.ts         CUSTOMIZABLE_AGENTS registry (add new agent CLIs here)
```

### Core invariants (do not break)

1. **Unset before export.** `AgentService.applyUnset()` removes inherited
   `ANTHROPIC_*`/`CLAUDE_CODE_OAUTH_TOKEN` vars from `process.env`, then
   `prepareEnv()` re-injects only Settings values into the child env. The
   child process must never see inherited proxy credentials.
2. **One key, all agents.** The primary API key is injected per agent type via
   `API_KEY_ENV_VARS_BY_TYPE` / `BASE_URL_ENV_VARS_BY_TYPE` (`src/types.ts`).
   Add a new type entry or per-agent `apiEnvVarOverrides` instead of hardcoding
   env var names in commands.
3. **Settings are the single source of truth.** Anything the flow needs
   (baseUrl, apiKey) must come from `SettingsService` (via
   `ensurePrerequisites` in interactive flows), never from `process.env`.
4. **Graceful degradation everywhere.** Models API failure -> local pools +
   `ui.warn`; missing settings -> prerequisite prompts; non-TTY -> static
   output, no spinner. Never crash the flow for an optional path.
5. **Spawn without shell.** `spawn(cmd, args, { shell: false })` — required for
   DEP0190 avoidance and correct arg passing.

## Code style

- **Never import `chalk` directly in commands/services** — all terminal output
  goes through `src/ui.ts` semantic primitives (`ui.ok/info/warn/danger`,
  `ui.h1/h2`, `ui.dlRow`, `ui.envvar/url/val/filepath/dim`, `ui.Spinner`).
  This mirrors the r-lib "semantic CLI" article; ui.ts is the only place
  styling may live.
- Symbols must have ASCII fallback via `sym` (ui.ts); dynamic output must check
  `isDynamic()` before using `\r`.
- ESM imports with `.js` extension even for `.ts` files (`moduleResolution:
  bundler` handles it, keep consistency).
- `strict` TypeScript; no `any` in public signatures.

## Adding a new agent CLI

1. Add an `Agent` entry to `CUSTOMIZABLE_AGENTS` in `src/services/registry.ts`
   (name, command, `envToUnset`, optional `apiEnvVarOverrides`).
2. Add its type's env vars to both `*_ENV_VARS_BY_TYPE` maps in `src/types.ts`
   if new.
3. If it persists config like Claude Code does, add a branch mirroring
   `claude-config.ts` in `customize.ts` step 4; otherwise the generic
   unset+export path works unchanged.

## Testing

There is no test runner. Use this recipe for end-to-end checks without
touching the developer's real config:

- Point settings elsewhere: `export XDG_CONFIG_HOME=$(mktemp -d)` **before**
  writing any test settings file (past mistake: a test seeded the real
  `~/.config/maxplus-ai/settings.json`).
- Fake HOME + a stub `claude` shell script on `PATH` that echoes received
  env/args, to assert what the spawn actually gets.
- Mock the models API with a tiny `node:http` server on `localhost:9099`
  (Bearer-checked, 2 pages to exercise pagination).
- `tsx -e` fails in this repo (CJS eval context) — put scratch scripts in
  `/tmp` instead. `package.json` is type: module; plain `node -e` is CJS.
- Always finish with `npx tsc --noEmit` and `npm run build`.

## Repository notes

- Binary name is **`maxplus-ai`** everywhere (package.json `bin`, help text,
  docs). The old name `masp` must not reappear.
- Settings/config paths always honor `XDG_CONFIG_HOME` and are created `0700`
  / files `0600` (secrets live there).
- `dist/`, `node_modules/`, `.recall/`, `.DS_Store` are git-ignored; don't
  commit build output.
- Conventional commits (`feat:` / `fix:` / `chore:`), small focused commits.
