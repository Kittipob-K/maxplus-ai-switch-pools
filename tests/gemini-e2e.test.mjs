import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("run configures Gemini CLI installer-parity files and clears inherited Gemini env", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "maxplus-gemini-e2e-"));
  const homeDir = join(root, "home");
  const configDir = join(root, "config");
  const binDir = join(root, "bin");
  const capturePath = join(root, "capture.json");
  await Promise.all([mkdir(homeDir), mkdir(binDir), mkdir(join(configDir, "maxplus-ai"), { recursive: true })]);

  const server = http.createServer((request, response) => {
    assert.equal(request.headers.authorization, "Bearer e2e-key");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      data: [{ id: "gemini-3-flash" }],
      has_more: false,
      maxplus: { models: { gemini: ["gemini-3-flash"] } },
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
  const stubPath = join(binDir, "gemini");
  await writeFile(
    stubPath,
    `#!/bin/sh\nnode -e 'const fs=require("node:fs"); fs.writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({args:process.argv.slice(1),geminiKey:process.env.GEMINI_API_KEY ?? null,googleKey:process.env.GOOGLE_API_KEY ?? null,baseUrl:process.env.GOOGLE_GEMINI_BASE_URL ?? null}));' -- "$@"\n`
  );
  await chmod(stubPath, 0o700);

  const result = await run(
    process.execPath,
    ["dist/index.js", "run", "-a", "gemini", "-p", "remote:gemini-3-flash"],
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
        // Inherited Gemini credentials must be scrubbed from the child env.
        GEMINI_API_KEY: "inherited-gemini",
        GOOGLE_GEMINI_BASE_URL: "https://inherited.example.com",
        GEMINI_MODEL: "inherited-model",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const capture = JSON.parse(await readFile(capturePath, "utf8"));
  // The key lives in ~/.gemini/.env (installer parity) — never in the env.
  assert.equal(capture.geminiKey, null);
  assert.equal(capture.googleKey, null);
  assert.equal(capture.baseUrl, null);

  const env = await readFile(join(homeDir, ".gemini", ".env"), "utf8");
  const endpoint = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  assert.equal(env.split("\n").includes(`GOOGLE_GEMINI_BASE_URL=${endpoint}`), true);
  assert.equal(env.split("\n").includes("GEMINI_MODEL=gemini-3-flash"), true);
  assert.equal(env.includes("inherited-gemini"), false);

  const settings = JSON.parse(await readFile(join(homeDir, ".gemini", "settings.json"), "utf8"));
  assert.equal(settings.security.auth.selectedType, "gemini-api-key");
});
