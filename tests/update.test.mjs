import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import { installUpdate, isNewerVersion } from "../dist/services/update.js";

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

test("isNewerVersion compares semantic versions", () => {
  assert.equal(isNewerVersion("0.1.2", "0.2.0"), true);
  assert.equal(isNewerVersion("0.1.2", "1.0.0"), true);
  assert.equal(isNewerVersion("0.2.0", "0.1.2"), false);
  assert.equal(isNewerVersion("1.2.3", "1.2.3"), false);
  assert.equal(isNewerVersion("1.2.3", "1.2.10"), true);
  assert.equal(isNewerVersion("1.2.3", "v1.3.0"), true);
  // Stable beats same-core prerelease; garbage never triggers an update.
  assert.equal(isNewerVersion("1.0.0-rc.1", "1.0.0"), true);
  assert.equal(isNewerVersion("1.0.0", "1.0.0-rc.1"), false);
  assert.equal(isNewerVersion("1.0.0", "not-a-version"), false);
  assert.equal(isNewerVersion("1.0.0", ""), false);
});

test("checkForUpdate hits the registry once, then serves from the 24h cache", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "maxplus-update-"));
  const configDir = join(root, "config");
  await mkdir(join(configDir, "maxplus-ai"), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));

  let hits = 0;
  const server = http.createServer((request, response) => {
    hits += 1;
    assert.equal(request.url, "/maxplus-ai-switch-pools/latest");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ version: "99.0.0" }));
  });
  await listen(server);
  t.after(() => server.close());
  const registryUrl = `http://127.0.0.1:${server.address().port}`;

  const updateModuleUrl = join(process.cwd(), "dist/services/update.js");
  async function checkInChild(checkOpts = {}, extraEnv = {}) {
    const script = `
      import { checkForUpdate } from ${JSON.stringify(updateModuleUrl)};
      const result = await checkForUpdate(${JSON.stringify({ timeoutMs: 3000, ...checkOpts })});
      console.log("RESULT:" + JSON.stringify(result));
    `;
    const res = await run(process.execPath, ["--input-type=module", "-e", script], {
      env: {
        ...process.env,
        XDG_CONFIG_HOME: configDir,
        MAXPLUS_DISABLE_KEYCHAIN: "1",
        MAXPLUS_REGISTRY_URL: registryUrl,
        ...extraEnv,
      },
    });
    assert.equal(res.code, 0, res.stderr || res.stdout);
    const line = res.stdout.split("\n").find((l) => l.startsWith("RESULT:"));
    return JSON.parse(line.slice("RESULT:".length));
  }

  // First call reaches the registry and reports the newer release.
  const first = await checkInChild();
  assert.equal(first.status, "update-available");
  assert.equal(first.latestVersion, "99.0.0");
  assert.equal(hits, 1);

  // Second call is served from the 24h cache — no extra registry hit.
  const second = await checkInChild();
  assert.equal(second.status, "update-available");
  assert.equal(second.latestVersion, "99.0.0");
  assert.equal(hits, 1);

  // force bypasses the cache.
  const third = await checkInChild({ force: true });
  assert.equal(hits, 2);
  assert.equal(third.status, "update-available");

  // The managed cache file holds the answer with a valid timestamp.
  const cache = JSON.parse(
    await readFile(join(configDir, "maxplus-ai", "update-check.json"), "utf8")
  );
  assert.equal(cache.latestVersion, "99.0.0");
  assert.ok(!Number.isNaN(Date.parse(cache.lastChecked)));
});

test("checkForUpdate reports up-to-date for an older registry version", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "maxplus-update-old-"));
  const configDir = join(root, "config");
  await mkdir(join(configDir, "maxplus-ai"), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));

  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ version: "0.0.1" }));
  });
  await listen(server);
  t.after(() => server.close());

  const script = `
    import { checkForUpdate } from ${JSON.stringify(join(process.cwd(), "dist/services/update.js"))};
    const result = await checkForUpdate({ timeoutMs: 3000 });
    console.log("RESULT:" + JSON.stringify(result));
  `;
  const res = await run(process.execPath, ["--input-type=module", "-e", script], {
    env: {
      ...process.env,
      XDG_CONFIG_HOME: configDir,
      MAXPLUS_DISABLE_KEYCHAIN: "1",
      MAXPLUS_REGISTRY_URL: `http://127.0.0.1:${server.address().port}`,
    },
  });
  assert.equal(res.code, 0, res.stderr || res.stdout);
  const line = res.stdout.split("\n").find((l) => l.startsWith("RESULT:"));
  const result = JSON.parse(line.slice("RESULT:".length));
  assert.equal(result.status, "up-to-date");
});

test("checkForUpdate degrades to unknown when the registry is unreachable", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "maxplus-update-offline-"));
  const configDir = join(root, "config");
  await mkdir(join(configDir, "maxplus-ai"), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));

  const script = `
    import { checkForUpdate } from ${JSON.stringify(join(process.cwd(), "dist/services/update.js"))};
    const result = await checkForUpdate({ timeoutMs: 500 });
    console.log("RESULT:" + JSON.stringify(result));
  `;
  const res = await run(process.execPath, ["--input-type=module", "-e", script], {
    env: {
      ...process.env,
      XDG_CONFIG_HOME: configDir,
      MAXPLUS_DISABLE_KEYCHAIN: "1",
      MAXPLUS_REGISTRY_URL: "http://127.0.0.1:1",
    },
  });
  assert.equal(res.code, 0, res.stderr || res.stdout);
  const line = res.stdout.split("\n").find((l) => l.startsWith("RESULT:"));
  const result = JSON.parse(line.slice("RESULT:".length));
  assert.equal(result.status, "unknown");
  assert.ok(result.error);
});

test("installUpdate spawns npm install -g without a shell", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "maxplus-npm-stub-"));
  const binDir = join(root, "bin");
  await mkdir(binDir, { recursive: true });
  const npmPath = join(binDir, "npm");
  await writeFile(
    npmPath,
    `#!/bin/sh\nnode -e 'const fs=require("node:fs"); fs.writeFileSync(process.env.NPM_CAPTURE, JSON.stringify({argv:process.argv.slice(1)}));' -- "$@"\n`
  );
  await chmod(npmPath, 0o700);
  const capture = join(root, "capture.json");
  t.after(() => rm(root, { recursive: true, force: true }));

  // PATH stub is set at require time is irrelevant; installUpdate spawns
  // `npm` resolved through the parent's PATH at call time.
  process.env.NPM_CAPTURE = capture;
  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}:${originalPath}`;
  try {
    const result = await installUpdate();
    assert.equal(result.ok, true, result.output);
  } finally {
    process.env.PATH = originalPath;
    delete process.env.NPM_CAPTURE;
  }

  const recorded = JSON.parse(await readFile(capture, "utf8"));
  assert.deepEqual(recorded.argv, ["install", "-g", "maxplus-ai-switch-pools@latest"]);
});

test("--update installs the newer release through the stub npm", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "maxplus-update-e2e-"));
  const homeDir = join(root, "home");
  const configDir = join(root, "config");
  const binDir = join(root, "bin");
  const capturePath = join(root, "npm-capture.json");
  await Promise.all([
    mkdir(homeDir),
    mkdir(binDir),
    mkdir(join(configDir, "maxplus-ai"), { recursive: true }),
  ]);
  t.after(() => rm(root, { recursive: true, force: true }));

  const server = http.createServer((request, response) => {
    assert.equal(request.url, "/maxplus-ai-switch-pools/latest");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ version: "99.0.0" }));
  });
  await listen(server);
  t.after(() => server.close());

  const npmPath = join(binDir, "npm");
  await writeFile(
    npmPath,
    `#!/bin/sh\necho "added 1 package in 1s"\nnode -e 'const fs=require("node:fs"); fs.writeFileSync(process.env.NPM_CAPTURE, JSON.stringify({argv:process.argv.slice(1)}));' -- "$@"\n`
  );
  await chmod(npmPath, 0o700);

  const result = await run(process.execPath, ["dist/index.js", "--update"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: homeDir,
      XDG_CONFIG_HOME: configDir,
      PATH: `${binDir}:${process.env.PATH}`,
      NPM_CAPTURE: capturePath,
      MAXPLUS_DISABLE_KEYCHAIN: "1",
      MAXPLUS_REGISTRY_URL: `http://127.0.0.1:${server.address().port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /99\.0\.0/);
  assert.match(result.stdout, /Updated to 99\.0\.0/);
  const recorded = JSON.parse(await readFile(capturePath, "utf8"));
  assert.deepEqual(recorded.argv, ["install", "-g", "maxplus-ai-switch-pools@latest"]);

  // A successful update refreshes the cache with the new version.
  const cache = JSON.parse(
    await readFile(join(configDir, "maxplus-ai", "update-check.json"), "utf8")
  );
  assert.equal(cache.latestVersion, "99.0.0");
});

test("--update reports up-to-date without touching npm", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "maxplus-update-fresh-"));
  const homeDir = join(root, "home");
  const configDir = join(root, "config");
  const binDir = join(root, "bin");
  await Promise.all([
    mkdir(homeDir),
    mkdir(binDir),
    mkdir(join(configDir, "maxplus-ai"), { recursive: true }),
  ]);
  t.after(() => rm(root, { recursive: true, force: true }));

  // Serve the current package version — nothing to do.
  const pkg = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ version: pkg.version }));
  });
  await listen(server);
  t.after(() => server.close());

  const npmPath = join(binDir, "npm");
  await writeFile(npmPath, `#!/bin/sh\nexit 42\n`);
  await chmod(npmPath, 0o700);

  const result = await run(process.execPath, ["dist/index.js", "--update"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: homeDir,
      XDG_CONFIG_HOME: configDir,
      PATH: `${binDir}:${process.env.PATH}`,
      MAXPLUS_DISABLE_KEYCHAIN: "1",
      MAXPLUS_REGISTRY_URL: `http://127.0.0.1:${server.address().port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /is up to date/);
});

test("startup notice prints an update hint before a subcommand runs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "maxplus-notice-e2e-"));
  const homeDir = join(root, "home");
  const configDir = join(root, "config");
  const binDir = join(root, "bin");
  await Promise.all([
    mkdir(homeDir),
    mkdir(binDir),
    mkdir(join(configDir, "maxplus-ai"), { recursive: true }),
  ]);
  t.after(() => rm(root, { recursive: true, force: true }));

  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ version: "99.0.0" }));
  });
  await listen(server);
  t.after(() => server.close());

  // `list --local` is TTY-independent work; the notice itself only prints on
  // a TTY, so simulate one via a pseudo-terminal script wrapper.
  const result = await run(
    "/usr/bin/script",
    ["-q", "/dev/null", process.execPath, "dist/index.js", "list", "--local"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: homeDir,
        XDG_CONFIG_HOME: configDir,
        PATH: `${binDir}:${process.env.PATH}`,
        MAXPLUS_DISABLE_KEYCHAIN: "1",
        MAXPLUS_REGISTRY_URL: `http://127.0.0.1:${server.address().port}`,
        TERM: "xterm-256color",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Update available/);
  assert.match(result.stdout, /maxplus-ai --update/);
});
