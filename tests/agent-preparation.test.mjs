import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { OpenCodeConfigService } from "../dist/services/opencode-config.js";

test("OpenCode config preserves other providers and references the key from env", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-opencode-"));
  const configPath = join(directory, "opencode.json");
  await writeFile(
    configPath,
    JSON.stringify({ provider: { existing: { name: "Existing" } } })
  );

  const result = await new OpenCodeConfigService(configPath).apply({
    endpoint: "https://gateway.example.com",
    models: [
      { id: "claude-model", apis: ["messages"] },
      { id: "chat-model", apis: ["chat_completions"] },
      { id: "responses-model", apis: ["responses"] },
    ],
    selected: "chat-model",
  });
  assert.deepEqual(result.staleModels, []);

  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.provider.existing.name, "Existing");
  assert.equal(config.provider["cli-hop"].options.apiKey, "{env:CLI_HOP_API_KEY}");
  assert.equal(
    config.provider["cli-hop"].options.baseURL,
    "https://gateway.example.com/v1"
  );
  assert.equal(config.$schema, undefined);
  assert.deepEqual(Object.keys(config.provider["cli-hop"].models), ["claude-model"]);
  assert.deepEqual(Object.keys(config.provider["cli-hop-openai"].models), ["chat-model"]);
  assert.equal(config.model, "cli-hop-openai/chat-model");
  assert.equal(config.small_model, "cli-hop-openai/chat-model");
  assert.equal(JSON.stringify(config).includes("test-key"), false);
});

test("OpenCode config adds the schema only when it creates the file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-opencode-"));
  const configPath = join(directory, "opencode.json");

  const created = await new OpenCodeConfigService(configPath).apply({
    endpoint: "https://gateway.example.com",
    models: [{ id: "chat-model", apis: ["chat_completions"] }],
    selected: "chat-model",
  });
  assert.deepEqual(created.staleModels, []);

  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.$schema, "https://opencode.ai/config.json");
  assert.equal(config.model, "cli-hop-openai/chat-model");
  assert.deepEqual(Object.keys(config.provider["cli-hop-openai"].models), ["chat-model"]);

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
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-opencode-"));
  const configPath = join(directory, "opencode.json");
  await writeFile(
    configPath,
    JSON.stringify({
      provider: {
        existing: { name: "Existing" },
        "cli-hop": {
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
  // Chat-capable saved models migrate to the OpenAI-compatible provider;
  // old-model has no live wire and stays in the Anthropic provider as stale.
  assert.deepEqual(result.staleModels, ["old-model"]);

  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.provider.existing.name, "Existing");
  assert.deepEqual(config.mcp.existing, { type: "remote" });
  assert.equal(config.provider["cli-hop"].npm, "@ai-sdk/anthropic");
  assert.equal(config.provider["cli-hop"].options.timeout, 60000);
  assert.deepEqual(config.provider["cli-hop"].options.headers, { "X-Workspace": "keep" });
  assert.deepEqual(Object.keys(config.provider["cli-hop"].models), ["old-model"]);
  assert.equal(config.provider["cli-hop-openai"].options.apiKey, "{env:CLI_HOP_API_KEY}");
  assert.deepEqual(Object.keys(config.provider["cli-hop-openai"].models), [
    "new-model",
    "shared-model",
  ]);
  assert.deepEqual(config.provider["cli-hop-openai"].models["new-model"], { name: "New model" });
  assert.equal(config.provider["cli-hop-openai"].models["shared-model"].name, "Updated shared name");
  assert.deepEqual(config.provider["cli-hop-openai"].models["shared-model"].limit, { output: 4096 });
  assert.equal(config.model, "cli-hop-openai/new-model");

  const second = await new OpenCodeConfigService(configPath).apply({
    endpoint: "https://gateway.example.com",
    models: [{ id: "another-model", apis: ["chat_completions"] }],
    selected: "another-model",
  });
  assert.deepEqual(second.staleModels, ["old-model", "new-model", "shared-model"]);

  const updated = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(Object.keys(updated.provider["cli-hop-openai"].models), [
    "another-model",
    "new-model",
    "shared-model",
  ]);
});

test("OpenCode config resolves the model name from displayName, then the saved name, then the id", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-opencode-"));
  const configPath = join(directory, "opencode.json");
  await writeFile(
    configPath,
    JSON.stringify({
      provider: {
        "cli-hop": {
          models: {
            "renamed-model": { name: "User edited label", limit: { context: 100000 } },
          },
        },
      },
    })
  );

  await new OpenCodeConfigService(configPath).apply({
    endpoint: "https://gateway.example.com",
    models: [
      { id: "renamed-model", apis: ["messages"] },
      { id: "gateway-named", displayName: "Gateway name", apis: ["messages"] },
      { id: "unlabeled", apis: ["messages"] },
    ],
    selected: "renamed-model",
  });

  const models = JSON.parse(await readFile(configPath, "utf8")).provider["cli-hop"].models;
  assert.equal(models["renamed-model"].name, "User edited label");
  assert.deepEqual(models["renamed-model"].limit, { context: 100000 });
  assert.equal(models["gateway-named"].name, "Gateway name");
  assert.equal(models["unlabeled"].name, "unlabeled");
});

test("OpenCode config leaves entries outside the catalogue untouched", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-opencode-"));
  const configPath = join(directory, "opencode.json");
  await writeFile(
    configPath,
    JSON.stringify({
      provider: {
        "cli-hop": { models: { "stray-null": null, "stray-string": "kept" } },
      },
    })
  );

  const result = await new OpenCodeConfigService(configPath).apply({
    endpoint: "https://gateway.example.com",
    models: [{ id: "model", apis: ["messages"] }],
    selected: "model",
  });

  assert.deepEqual(result.staleModels, ["stray-null", "stray-string"]);
  const models = JSON.parse(await readFile(configPath, "utf8")).provider["cli-hop"].models;
  assert.equal(models["stray-null"], null);
  assert.equal(models["stray-string"], "kept");
  assert.deepEqual(models.model, { name: "model" });
});

test("OpenCode config routes each wire to its own provider without calling models retired", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-opencode-"));
  const configPath = join(directory, "opencode.json");
  await writeFile(
    configPath,
    JSON.stringify({
      provider: {
        "cli-hop": { models: { "messages-only": { name: "Messages only" } } },
      },
    })
  );

  const result = await new OpenCodeConfigService(configPath).apply({
    endpoint: "https://gateway.example.com",
    models: [
      { id: "messages-only", apis: ["messages"] },
      { id: "chat-model", apis: ["chat_completions"] },
    ],
    selected: "chat-model",
  });

  // The gateway still serves both models; each wire just gets its own provider.
  assert.deepEqual(result.staleModels, []);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(config.provider["cli-hop"].models["messages-only"], { name: "Messages only" });
  assert.deepEqual(config.provider["cli-hop-openai"].models["chat-model"], { name: "chat-model" });
  assert.equal(config.model, "cli-hop-openai/chat-model");
});

test("OpenCode config prefers the Anthropic provider ref for a messages-only selection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-opencode-"));
  const configPath = join(directory, "opencode.json");

  await new OpenCodeConfigService(configPath).apply({
    endpoint: "https://gateway.example.com",
    models: [
      { id: "claude-model", apis: ["messages"] },
      { id: "chat-model", apis: ["chat_completions"] },
    ],
    selected: "claude-model",
  });

  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.model, "cli-hop/claude-model");
  assert.equal(config.small_model, "cli-hop/claude-model");
});

test("OpenCode config skips retired-model reporting when the gateway catalogue is unknown", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-opencode-"));
  const configPath = join(directory, "opencode.json");
  await writeFile(
    configPath,
    JSON.stringify({
      provider: {
        "cli-hop": {
          models: {
            "saved-a": { name: "A" },
            "saved-b": { name: "B" },
          },
        },
      },
    })
  );

  // No capabilities means the models API was unreachable and cli-hop fell
  // back to its built-in pools, so the catalogue cannot prove anything is gone.
  const result = await new OpenCodeConfigService(configPath).apply({
    endpoint: "https://gateway.example.com",
    models: [{ id: "local-model" }],
    selected: "local-model",
  });

  assert.deepEqual(result.staleModels, []);
  const models = JSON.parse(await readFile(configPath, "utf8")).provider["cli-hop"].models;
  assert.equal(models["saved-a"].name, "A");
  assert.equal(models["saved-b"].name, "B");
});

test("OpenCode config keeps a saved label when the gateway sends an empty displayName", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-opencode-"));
  const configPath = join(directory, "opencode.json");
  await writeFile(
    configPath,
    JSON.stringify({
      provider: {
        "cli-hop": { models: { "blank-name": { name: "Saved label" } } },
      },
    })
  );

  await new OpenCodeConfigService(configPath).apply({
    endpoint: "https://gateway.example.com",
    models: [{ id: "blank-name", displayName: "", apis: ["messages"] }],
    selected: "blank-name",
  });

  const models = JSON.parse(await readFile(configPath, "utf8")).provider["cli-hop"].models;
  assert.equal(models["blank-name"].name, "Saved label");
});

test("OpenCode config keeps a pre-existing $schema value", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-opencode-"));
  const configPath = join(directory, "opencode.json");
  await writeFile(
    configPath,
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      provider: {},
    })
  );

  await new OpenCodeConfigService(configPath).apply({
    endpoint: "https://gateway.example.com",
    models: [{ id: "chat-model", apis: ["chat_completions"] }],
    selected: "chat-model",
  });

  assert.equal(
    (await readFile(configPath, "utf8")).includes("https://opencode.ai/config.json"),
    true
  );
  assert.equal(
    JSON.parse(await readFile(configPath, "utf8")).$schema,
    "https://opencode.ai/config.json"
  );
});
