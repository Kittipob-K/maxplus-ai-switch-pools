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

  await new OpenCodeConfigService(configPath).apply({
    endpoint: "https://gateway.example.com",
    models: [
      { id: "chat-model", apis: ["chat_completions"] },
      { id: "responses-model", apis: ["responses"] },
    ],
    selected: "chat-model",
  });

  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.provider.existing.name, "Existing");
  assert.equal(config.provider.maxplus.options.apiKey, "{env:MAXPLUS_API_KEY}");
  assert.equal(
    config.provider.maxplus.options.baseURL,
    "https://gateway.example.com/v1"
  );
  assert.deepEqual(Object.keys(config.provider.maxplus.models), ["chat-model"]);
  assert.equal(JSON.stringify(config).includes("test-key"), false);
});
