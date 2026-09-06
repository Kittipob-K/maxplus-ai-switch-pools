import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("run launches Aider with paginated MaxPlus models and a clean environment", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "maxplus-e2e-"));
  const homeDir = join(root, "home");
  const configDir = join(root, "config");
  const binDir = join(root, "bin");
  const capturePath = join(root, "capture.json");
  await Promise.all([mkdir(homeDir), mkdir(binDir), mkdir(join(configDir, "maxplus-ai"), { recursive: true })]);

  const server = http.createServer((request, response) => {
    assert.equal(request.headers.authorization, "Bearer e2e-key");
    const url = new URL(request.url, "http://localhost");
    response.setHeader("content-type", "application/json");
    if (!url.searchParams.has("after_id")) {
      response.end(JSON.stringify({
        data: [{ id: "messages-only" }],
        has_more: true,
        last_id: "page-1",
        maxplus: { models: { messages: ["messages-only"] } },
      }));
      return;
    }
    response.end(JSON.stringify({
      data: [{ id: "chat-model" }],
      has_more: false,
      maxplus: { models: { chat_completions: ["chat-model"] } },
    }));
  });
  const address = await listen(server);
  context.after(() => server.close());
  assert.equal(typeof address, "object");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  await writeFile(
    join(configDir, "maxplus-ai", "settings.json"),
    JSON.stringify({ apiKey: "e2e-key", baseUrl })
  );
  const stubPath = join(binDir, "aider");
  await writeFile(
    stubPath,
    `#!/bin/sh\nnode -e 'const fs=require("node:fs"); fs.writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({args:process.argv.slice(1),openaiKey:process.env.OPENAI_API_KEY,openaiBase:process.env.OPENAI_API_BASE,anthropicKey:process.env.ANTHROPIC_API_KEY ?? null}));' -- "$@"\n`
  );
  await chmod(stubPath, 0o700);

  const result = await run(
    process.execPath,
    ["dist/index.js", "run", "-a", "aider", "-p", "remote:chat-model"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: homeDir,
        XDG_CONFIG_HOME: configDir,
        PATH: `${binDir}:${process.env.PATH}`,
        CAPTURE_PATH: capturePath,
        MAXPLUS_DISABLE_KEYCHAIN: "1",
        MAXPLUS_NO_UPDATE_CHECK: "1",
        OPENAI_API_KEY: "inherited-openai",
        OPENAI_API_BASE: "https://inherited.example.com",
        ANTHROPIC_API_KEY: "inherited-anthropic",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const capture = JSON.parse(await readFile(capturePath, "utf8"));
  assert.deepEqual(capture.args, ["--model", "openai/chat-model"]);
  assert.equal(capture.openaiKey, "e2e-key");
  assert.equal(capture.openaiBase, baseUrl);
  assert.equal(capture.anthropicKey, null);
});

async function createFixture(context) {
  const root = await mkdtemp(join(tmpdir(), "maxplus-agent-e2e-"));
  const homeDir = join(root, "home");
  const configDir = join(root, "config");
  const binDir = join(root, "bin");
  const capturePath = join(root, "capture.json");
  await Promise.all([mkdir(homeDir), mkdir(binDir), mkdir(join(configDir, "maxplus-ai"), { recursive: true })]);

  const server = http.createServer((request, response) => {
    assert.equal(request.headers.authorization, "Bearer e2e-key");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      data: [
        { id: "chat-model" },
        { id: "responses-model" },
      ],
      has_more: false,
      maxplus: {
        models: {
          chat_completions: ["chat-model"],
          responses: ["responses-model"],
        },
      },
    }));
  });
  const address = await listen(server);
  context.after(() => server.close());
  assert.equal(typeof address, "object");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  await writeFile(
    join(configDir, "maxplus-ai", "settings.json"),
    JSON.stringify({ apiKey: "e2e-key", baseUrl })
  );

  return { root, homeDir, configDir, binDir, capturePath, baseUrl };
}

async function writeCaptureStub(binDir, command) {
  const stubPath = join(binDir, command);
  await writeFile(
    stubPath,
    `#!/bin/sh\nnode -e 'const fs=require("node:fs"); fs.writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({args:process.argv.slice(1),maxplusKey:process.env.MAXPLUS_API_KEY ?? null,anthropicKey:process.env.ANTHROPIC_API_KEY ?? null,openaiKey:process.env.OPENAI_API_KEY ?? null,piDir:process.env.PI_CODING_AGENT_DIR ?? null}));' -- "$@"\n`
  );
  await chmod(stubPath, 0o700);
}

function fixtureEnv(fixture) {
  return {
    ...process.env,
    HOME: fixture.homeDir,
    XDG_CONFIG_HOME: fixture.configDir,
    PATH: `${fixture.binDir}:${process.env.PATH}`,
    CAPTURE_PATH: fixture.capturePath,
    MAXPLUS_DISABLE_KEYCHAIN: "1",
    MAXPLUS_NO_UPDATE_CHECK: "1",
    MAXPLUS_API_KEY: "inherited-maxplus",
    ANTHROPIC_API_KEY: "inherited-anthropic",
    OPENAI_API_KEY: "inherited-openai",
    PI_CODING_AGENT_DIR: "/inherited/pi",
  };
}

test("run syncs Pi config and launches the selected provider model", async (context) => {
  const fixture = await createFixture(context);
  await writeCaptureStub(fixture.binDir, "pi");
  const piConfigPath = join(fixture.homeDir, ".pi", "agent", "models.json");
  await mkdir(join(fixture.homeDir, ".pi", "agent"), { recursive: true });
  await writeFile(piConfigPath, JSON.stringify({ providers: { existing: { name: "Existing" } } }));

  const result = await run(
    process.execPath,
    ["dist/index.js", "run", "-a", "pi", "-p", "remote:chat-model"],
    { cwd: process.cwd(), env: fixtureEnv(fixture), stdio: ["ignore", "pipe", "pipe"] }
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const capture = JSON.parse(await readFile(fixture.capturePath, "utf8"));
  assert.deepEqual(capture.args, ["--model", "maxplus/chat-model"]);
  assert.equal(capture.maxplusKey, "e2e-key");
  assert.equal(capture.anthropicKey, null);
  assert.equal(capture.openaiKey, null);
  assert.equal(capture.piDir, null);
  const config = JSON.parse(await readFile(piConfigPath, "utf8"));
  assert.equal(config.providers.existing.name, "Existing");
  assert.equal(config.providers.maxplus.apiKey, "$MAXPLUS_API_KEY");
  assert.deepEqual(config.providers.maxplus.models.map((model) => model.id), ["chat-model", "responses-model"]);
});

test("run syncs OpenCode without storing the primary key", async (context) => {
  const fixture = await createFixture(context);
  await writeCaptureStub(fixture.binDir, "opencode");

  const result = await run(
    process.execPath,
    ["dist/index.js", "run", "-a", "opencode", "-p", "remote:chat-model"],
    { cwd: process.cwd(), env: fixtureEnv(fixture), stdio: ["ignore", "pipe", "pipe"] }
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const capture = JSON.parse(await readFile(fixture.capturePath, "utf8"));
  assert.deepEqual(capture.args, ["--model", "maxplus/chat-model"]);
  assert.equal(capture.maxplusKey, "e2e-key");
  const raw = await readFile(join(fixture.configDir, "opencode", "opencode.json"), "utf8");
  assert.equal(raw.includes("e2e-key"), false);
  assert.equal(JSON.parse(raw).provider.maxplus.options.apiKey, "{env:MAXPLUS_API_KEY}");
});

test("run warns about OpenCode models the gateway no longer serves", async (context) => {
  const fixture = await createFixture(context);
  await writeCaptureStub(fixture.binDir, "opencode");
  const opencodeConfigPath = join(fixture.configDir, "opencode", "opencode.json");
  await mkdir(dirname(opencodeConfigPath), { recursive: true });
  await writeFile(
    opencodeConfigPath,
    JSON.stringify({
      provider: {
        maxplus: { models: { "retired-model": { name: "Retired model" } } },
      },
    })
  );

  const result = await run(
    process.execPath,
    ["dist/index.js", "run", "-a", "opencode", "-p", "remote:chat-model"],
    { cwd: process.cwd(), env: fixtureEnv(fixture), stdio: ["ignore", "pipe", "pipe"] }
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /retired-model/);
  assert.match(result.stdout, /kept in opencode\.json/);
  const config = JSON.parse(await readFile(opencodeConfigPath, "utf8"));
  assert.equal(config.provider.maxplus.models["retired-model"].name, "Retired model");
});

test("run launches Codex with Responses provider overrides", async (context) => {
  const fixture = await createFixture(context);
  await writeCaptureStub(fixture.binDir, "codex");

  const result = await run(
    process.execPath,
    ["dist/index.js", "run", "-a", "codex", "-p", "remote:responses-model"],
    { cwd: process.cwd(), env: fixtureEnv(fixture), stdio: ["ignore", "pipe", "pipe"] }
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const capture = JSON.parse(await readFile(fixture.capturePath, "utf8"));
  assert.equal(capture.maxplusKey, "e2e-key");
  assert.equal(capture.anthropicKey, null);
  assert.equal(capture.openaiKey, null);
  assert.deepEqual(capture.args.slice(0, 2), ["--model", "responses-model"]);
  assert.ok(capture.args.includes('model_provider="maxplus"'));
  assert.ok(capture.args.includes('model_providers.maxplus.wire_api="responses"'));
  assert.ok(capture.args.includes(`model_providers.maxplus.base_url="${fixture.baseUrl}"`));
});

test("run writes the Grok managed config block and launches without a key env var", async (context) => {
  const fixture = await createFixture(context);
  await writeCaptureStub(fixture.binDir, "grok");

  const result = await run(
    process.execPath,
    ["dist/index.js", "run", "-a", "grok", "-p", "remote:responses-model"],
    { cwd: process.cwd(), env: fixtureEnv(fixture), stdio: ["ignore", "pipe", "pipe"] }
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const capture = JSON.parse(await readFile(fixture.capturePath, "utf8"));
  assert.equal(capture.maxplusKey, null);
  assert.equal(capture.anthropicKey, null);
  assert.equal(capture.openaiKey, null);
  assert.deepEqual(capture.args, []);
  const raw = await readFile(join(fixture.homeDir, ".grok", "config.toml"), "utf8");
  assert.equal(raw.includes("# >>> MaxPlus AI Grok Build >>>"), true);
  assert.match(raw, /\[model\."responses-model"\]/);
  assert.match(raw, /base_url = ".*\/grok\/v1"/);
  assert.match(raw, /api_key = "e2e-key"/);
  assert.match(raw, /api_backend = "responses"/);
  assert.match(raw, /default = "responses-model"/);
  assert.match(raw, /models_base_url = /);
  assert.match(raw, /default_skills_installs_purged = true/);
});

test("model override uses the effective model protocol instead of the pool protocol", async (context) => {
  const fixture = await createFixture(context);
  await writeCaptureStub(fixture.binDir, "codex");

  const result = await run(
    process.execPath,
    [
      "dist/index.js",
      "run",
      "-a",
      "codex",
      "-p",
      "remote:chat-model",
      "-m",
      "responses-model",
    ],
    { cwd: process.cwd(), env: fixtureEnv(fixture), stdio: ["ignore", "pipe", "pipe"] }
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const capture = JSON.parse(await readFile(fixture.capturePath, "utf8"));
  assert.deepEqual(capture.args.slice(0, 2), ["--model", "responses-model"]);
});
