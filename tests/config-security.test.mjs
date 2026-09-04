import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { PiConfigService } from "../dist/services/pi-config.js";
import { SettingsService } from "../dist/services/settings.js";
import { ClaudeConfigService } from "../dist/services/claude-config.js";
import { OmpConfigService } from "../dist/services/omp-config.js";

test("Pi config merge is secret-free and uses private permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "maxplus-pi-"));
  const modelsPath = join(directory, "agent", "models.json");
  await mkdir(dirname(modelsPath), { recursive: true });
  await writeFile(modelsPath, '{\n  // keep provider\n  "providers": { "existing": {} }\n}\n');

  await new PiConfigService(modelsPath).apply({
    endpoint: "https://gateway.example.com",
    models: [{ id: "model", apis: ["responses"] }],
    selected: "model",
  });

  const raw = await readFile(modelsPath, "utf8");
  const config = JSON.parse(raw);
  assert.ok(config.providers.existing);
  assert.equal(config.providers.maxplus.apiKey, "$MAXPLUS_API_KEY");
  assert.equal(raw.includes("test-key"), false);
  assert.equal((await stat(dirname(modelsPath))).mode & 0o777, 0o700);
  assert.equal((await stat(modelsPath)).mode & 0o777, 0o600);
});

test("Settings save enforces private file permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "maxplus-settings-"));
  const filePath = join(directory, "maxplus-ai", "settings.json");
  const settings = new SettingsService(filePath);

  await settings.save({ apiKey: "test-key", baseUrl: "https://example.com/v1" });

  assert.equal((await stat(dirname(filePath))).mode & 0o777, 0o700);
  assert.equal((await stat(filePath)).mode & 0o777, 0o600);
});

test("Claude config refuses to overwrite malformed JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "maxplus-claude-"));
  const claudeJsonPath = join(directory, ".claude.json");
  const settingsPath = join(directory, ".claude", "settings.json");
  await writeFile(claudeJsonPath, "{ malformed");

  await assert.rejects(
    new ClaudeConfigService({ claudeJsonPath, settingsPath }).apply({
      apiKey: "test-key",
      endpoint: "https://example.com",
      model: "model",
    }),
    /is not valid JSON/
  );
  assert.equal(await readFile(claudeJsonPath, "utf8"), "{ malformed");
});

test("Claude root config preserves the parent directory permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "maxplus-claude-parent-"));
  await chmod(directory, 0o750);
  const claudeJsonPath = join(directory, ".claude.json");
  const settingsPath = join(directory, ".claude", "settings.json");

  await new ClaudeConfigService({ claudeJsonPath, settingsPath }).apply({
    apiKey: "test-key",
    endpoint: "https://example.com",
    model: "model",
  });

  assert.equal((await stat(directory)).mode & 0o777, 0o750);
  assert.equal((await stat(join(directory, ".claude"))).mode & 0o777, 0o700);
  assert.equal((await stat(claudeJsonPath)).mode & 0o777, 0o600);
  assert.equal((await stat(settingsPath)).mode & 0o777, 0o600);
});

test("OMP config refuses an invalid providers value", async () => {
  const directory = await mkdtemp(join(tmpdir(), "maxplus-omp-"));
  const modelsPath = join(directory, "agent", "models.yml");
  await mkdir(dirname(modelsPath), { recursive: true });
  await writeFile(modelsPath, "providers: invalid\n");

  await assert.rejects(
    new OmpConfigService(modelsPath).apply({
      endpoint: "https://example.com",
      models: [{ id: "model" }],
      selected: "model",
    }),
    /invalid providers object/
  );
  assert.equal(await readFile(modelsPath, "utf8"), "providers: invalid\n");
});
