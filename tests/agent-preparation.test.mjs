import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { OpenCodeConfigService } from "../dist/services/opencode-config.js";

test("OpenCode config preserves other providers and references the key from env", async () => {
  const directory = await mkdtemp(join(tmpdir(), "maxplus-opencode-"));
  const configPath = join(directory, "opencode.json");
  await writeFile(
    configPath,
    JSON.stringify({ provider: { existing: { name: "Existing" } } })
  );

  const result = await new OpenCodeConfigService(configPath).apply({
    endpoint: "https://gateway.example.com",
    models: [
      { id: "chat-model", apis: ["chat_completions"] },
      { id: "responses-model", apis: ["responses"] },
    ],
    selected: "chat-model",
  });
  assert.deepEqual(result.staleModels, []);

  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.provider.existing.name, "Existing");
  assert.equal(config.provider.maxplus.options.apiKey, "{env:MAXPLUS_API_KEY}");
  assert.equal(
    config.provider.maxplus.options.baseURL,
    "https://gateway.example.com/v1"
  );
  assert.equal(config.$schema, undefined);
  assert.deepEqual(Object.keys(config.provider.maxplus.models), ["chat-model"]);
  assert.equal(JSON.stringify(config).includes("test-key"), false);
});

test("OpenCode config adds the schema only when it creates the file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "maxplus-opencode-"));
  const configPath = join(directory, "opencode.json");

  const created = await new OpenCodeConfigService(configPath).apply({
    endpoint: "https://gateway.example.com",
    models: [{ id: "chat-model", apis: ["chat_completions"] }],
    selected: "chat-model",
  });
  assert.deepEqual(created.staleModels, []);

  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.$schema, "https://opencode.ai/config.json");
  assert.deepEqual(Object.keys(config.provider.maxplus.models), ["chat-model"]);

  await writeFile(configPath, JSON.stringify({ theme: "dark" }));

  await new OpenCodeConfigService(configPath).apply({
    endpoint: "https://gateway.example.com",
    models: [{ id: "chat-model", apis: ["chat_completions"] }],
    selected: "chat-model",
  });

  const untouchedSchema = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(untouchedSchema.$schema, undefined);
  assert.equal(untouchedSchema.theme, "dark");
});

test("OpenCode config adds new models without dropping existing model settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "maxplus-opencode-"));
  const configPath = join(directory, "opencode.json");
  await writeFile(
    configPath,
    JSON.stringify({
      provider: {
        existing: { name: "Existing" },
        maxplus: {
          options: {
            timeout: 60000,
            headers: { "X-Workspace": "keep" },
          },
          models: {
            "old-model": {
              name: "Old model",
              limit: { context: 100000 },
            },
            "shared-model": {
              name: "Original shared name",
              limit: { output: 4096 },
            },
          },
        },
      },
      mcp: { existing: { type: "remote" } },
    })
  );

  const result = await new OpenCodeConfigService(configPath).apply({
    endpoint: "https://gateway.example.com",
    models: [
      { id: "new-model", displayName: "New model", apis: ["chat_completions"] },
      { id: "shared-model", displayName: "Updated shared name", apis: ["chat_completions"] },
      { id: "responses-model", apis: ["responses"] },
    ],
    selected: "new-model",
  });
  assert.equal(result.path, configPath);
  assert.deepEqual(result.staleModels, ["old-model"]);

  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.provider.existing.name, "Existing");
  assert.deepEqual(config.mcp.existing, { type: "remote" });
  assert.equal(config.provider.maxplus.options.timeout, 60000);
  assert.deepEqual(config.provider.maxplus.options.headers, { "X-Workspace": "keep" });
  assert.equal(config.provider.maxplus.options.apiKey, "{env:MAXPLUS_API_KEY}");
  assert.deepEqual(Object.keys(config.provider.maxplus.models), [
    "new-model",
    "shared-model",
    "old-model",
  ]);
  assert.deepEqual(config.provider.maxplus.models["new-model"], { name: "New model" });
  assert.equal(config.provider.maxplus.models["shared-model"].name, "Updated shared name");
  assert.deepEqual(config.provider.maxplus.models["shared-model"].limit, { output: 4096 });
  assert.deepEqual(config.provider.maxplus.models["old-model"].limit, { context: 100000 });
  assert.equal(config.provider.maxplus.models["responses-model"], undefined);

  const second = await new OpenCodeConfigService(configPath).apply({
    endpoint: "https://gateway.example.com",
    models: [{ id: "another-model", apis: ["chat_completions"] }],
    selected: "another-model",
  });
  assert.deepEqual(second.staleModels, ["new-model", "shared-model", "old-model"]);

  const updated = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(Object.keys(updated.provider.maxplus.models), [
    "another-model",
    "new-model",
    "shared-model",
    "old-model",
  ]);
});
