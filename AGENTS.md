# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this project is

`maxplus-ai-switch-pools` is a TypeScript ESM CLI (binary: **`maxplus-ai`**) that
switches AI pools/models and configures agent CLIs to
use the MaxPlus AI gateway with one primary API key. See `README.md` for
user-facing docs.

## Commands

```bash
npm run build        # tsc -> dist/ (ESM)
npx tsc --noEmit     # typecheck only
npm test             # build + node:test unit/config/E2E suite
npm run dev          # run via tsx without building
node dist/index.js   # built CLI; `maxplus-ai` = npm link global
```

- Node.js **>= 22** required (`Promise.withResolvers` is used).
- Tests use the built-in `node:test` runner (see Testing below).

## Architecture

```
src/
  index.ts              commander program; no-args entry -> customize flow
  types.ts              shared types, protocols, launch/config contracts
  ui.ts                 semantic CLI output primitives (r-lib cli style)
  commands/
    customize.ts        default interactive flow (pick agent -> fetch models -> launch)
    settings.ts         Settings menu (API key / base URL) + `maxplus-ai settings`
    run.ts              non-interactive launch: maxplus-ai run [-p pool] [-m model] [-- args]
    list.ts             model list (remote, --local fallback)
  services/
    settings.ts         SettingsService: Credential Store — keychain-first API key + ~/.config/maxplus-ai/settings.json
    keychain.ts         openKeychain(): OS keychain entry (service maxplus-ai, account = username); null when unavailable/disabled
    prereq.ts           ensurePrerequisites(): inline prompts for missing baseUrl/apiKey
    pool.ts             PoolService: local pools + MaxPlus /models API (Bearer, pagination)
    agent.ts            AgentService: prepare launch plan, clean env, spawn agent
    claude-config.ts    installer-parity writes of ~/.claude.json + ~/.claude/settings.json
    omp-config.ts       merge-write ~/.omp/agent/models.yml (per-model wire api
                        from MaxPlus /models capabilities)
    pi-config.ts        merge-write ~/.pi/agent/models.json
    opencode-config.ts  merge-write ~/.config/opencode/opencode.json
    secure-file.ts      atomic 0600 writes + managed-directory permissions
    registry.ts         agent adapters: env, protocols, args, config preparation
```

### Core invariants (do not break)

1. **Unset before export.** `AgentService.applyUnset()` removes inherited
   Anthropic/OpenAI/MaxPlus proxy credentials from `process.env`, then
   `prepareEnv()` re-injects only Settings values into the child env. The
   child process must never see inherited proxy credentials.
2. **One key, all agents.** The primary API key is injected using each registry
   entry's `apiKeyEnvVars` / `baseUrlEnvVars`. Never hardcode agent env names in
   commands.
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

1. Add one `Agent` adapter to `CUSTOMIZABLE_AGENTS` in
   `src/services/registry.ts`: command, env mapping, supported protocols, model
   argument behavior, and optional `prepare` config writer.
2. Do not add agent-specific branches to `run.ts` or `customize.ts`; both flows
   must stay behind `AgentService.prepare()` / `createLaunchPlan()`.
3. Add launch-plan/config tests plus an isolated E2E test using temporary
   HOME/XDG and a stub executable.

## Testing

Run `npm test`. E2E tests follow this recipe without touching the developer's
real config:

- Point settings elsewhere: `export XDG_CONFIG_HOME=$(mktemp -d)` **before**
  writing any test settings file (past mistake: a test seeded the real
  `~/.config/maxplus-ai/settings.json`).
- Set `MAXPLUS_DISABLE_KEYCHAIN=1` in any process that exercises settings —
  HOME/XDG redirection does **not** isolate the OS keychain, and tests must not
  touch (or prompt against) the developer's real one. Unit-test keychain
  behavior by passing a fake `{ keychain }` to `SettingsService`.
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
  / files `0600` (the fallback home for the API key; keychain-first per ADR 0001).
- `dist/`, `node_modules/`, `.recall/`, `.DS_Store` are git-ignored; don't
  commit build output.
- Conventional commits (`feat:` / `fix:` / `chore:`), small focused commits.
