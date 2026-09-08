import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GrokConfigService,
  mergeGrokToml,
  GROK_CONFIG_MARKER_END,
  GROK_CONFIG_MARKER_START,
} from "../dist/services/grok-config.js";

function managedBlock(model = "grok-4.5", baseUrl = "https://gateway.example.com/v1") {
  return [
    GROK_CONFIG_MARKER_START,
    `[model."${model}"]`,
    `model = "${model}"`,
    `base_url = "${baseUrl}"`,
    `name = "${model}"`,
    `description = "${model}"`,
    'api_key = "test-key"',
    'api_backend = "chat_completions"',
    "context_window = 1000000",
    GROK_CONFIG_MARKER_END,
    "",
  ].join("\n");
}

test("Grok merge replaces a stale managed model section and keeps user content", () => {
  const existing = [
    'theme = "dark"',
    "",
    "[models]",
    'default = "old-model"',
    'web_search = "old-model"',
    'fallback = "user-model"',
    "",
    "[endpoints]",
    'models_base_url = "https://old.example.com"',
    "",
    '[model."old-model"]',
    'model = "old-model"',
    'api_key = "user-own-key"',
    "",
    "[profile]",
    'editor = "vim"',
    "",
  ].join("\n");

  const merged = mergeGrokToml(existing, {
    apiKey: "test-key",
    endpoint: "https://gateway.example.com",
    model: "grok-4.5",
    displayName: "Grok 4.5",
    contextWindow: 1000000,
  });

  // A [model."id"] section without CLI Hop markers belongs to the user and
  // is preserved (installer parity).
  assert.equal(merged.includes('api_key = "user-own-key"'), true);
  assert.equal(merged.includes('theme = "dark"'), true);
  assert.equal(merged.includes('fallback = "user-model"'), true);
  assert.equal(merged.includes('editor = "vim"'), true);
  assert.match(merged, /\[models\]\ndefault = "grok-4\.5"\nweb_search = "grok-4\.5"\nfallback = "user-model"/);
  assert.match(merged, /\[endpoints\]\nmodels_base_url = "https:\/\/gateway\.example\.com"/);
  assert.match(merged, /\[marketplace\]\ndefault_skills_installs_purged = true/);
  assert.match(merged, new RegExp(`${GROK_CONFIG_MARKER_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(
    merged,
    /\[model\."grok-4\.5"\]\nmodel = "grok-4\.5"\nbase_url = "https:\/\/gateway\.example\.com\/v1"\nname = "Grok 4\.5"\ndescription = "Grok 4\.5"\napi_key = "test-key"\napi_backend = "chat_completions"\ncontext_window = 1000000/
  );
  assert.equal(merged.includes(GROK_CONFIG_MARKER_END), true);
});

test("Grok merge appends missing sections to an unrelated config", () => {
  const merged = mergeGrokToml('[profile]\neditor = "vim"\n', {
    apiKey: "test-key",
    endpoint: "https://gateway.example.com",
    model: "grok-composer-2.5-fast",
  });

  assert.match(merged, /\[models\]\ndefault = "grok-composer-2\.5-fast"\nweb_search = "grok-composer-2\.5-fast"/);
  assert.match(merged, /\[endpoints\]\nmodels_base_url = "https:\/\/gateway\.example\.com"/);
  assert.match(merged, /\[marketplace\]\ndefault_skills_installs_purged = true/);
  assert.match(merged, /base_url = "https:\/\/gateway\.example\.com\/v1"/);
  assert.match(merged, /context_window = 200000/);
  assert.match(merged, /\[profile\]\neditor = "vim"/);
});

test("Grok merge is idempotent for repeated writes", () => {
  const input = {
    apiKey: "test-key",
    endpoint: "https://gateway.example.com",
    model: "grok-4.5",
  };
  const first = mergeGrokToml("", input);
  const second = mergeGrokToml(first, input);
  assert.equal(second, first);
});

test("Grok merge replaces a block written by the official installer", () => {
  const installerWritten = [
    "[models]",
    'default = "grok-4.5"',
    'web_search = "grok-4.5"',
    "",
    "[endpoints]",
    'models_base_url = "https://api["cli-hop"].cc"',
    "",
    "[marketplace]",
    "default_skills_installs_purged = true",
    "",
    GROK_CONFIG_MARKER_START,
    '[model."grok-4.5"]',
    'model = "grok-4.5"',
    'base_url = "https://api["cli-hop"].cc/v1"',
    'name = "Grok 4.5"',
    'description = "Grok 4.5"',
    'api_key = "ccsk-old"',
    'api_backend = "chat_completions"',
    "context_window = 1000000",
    GROK_CONFIG_MARKER_END,
    "",
  ].join("\n");

  const merged = mergeGrokToml(installerWritten, {
    apiKey: "ccsk-new",
    endpoint: "https://gateway.example.com",
    model: "grok-4.5",
  });

  assert.equal(merged.match(new RegExp(GROK_CONFIG_MARKER_START, "g"))?.length, 1);
  assert.equal(merged.includes("ccsk-old"), false);
  assert.equal(merged.includes("ccsk-new"), true);
  assert.equal(merged.includes("https://gateway.example.com/v1"), true);
});

test("Grok merge drops a managed model section even without the marker end", () => {
  const existing = [
    '[model."cli-hop-grok-build"]',
    'model = "cli-hop-grok-build"',
    'api_key = "old"',
    "",
    "[user]",
    "kept = true",
  ].join("\n");

  const merged = mergeGrokToml(existing, {
    apiKey: "test-key",
    endpoint: "https://gateway.example.com",
    model: "grok-4.5",
  });

  assert.equal(merged.includes("cli-hop-grok-build"), false);
  assert.equal(merged.includes("old"), false);
  assert.equal(merged.includes("kept = true"), true);
});

test("Grok config service writes owner-only config and merges in place", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-grok-"));
  const configPath = join(directory, "config.toml");
  await writeFile(configPath, "[user]\nkept = true\n");

  const changed = await new GrokConfigService(configPath).apply({
    apiKey: "test-key",
    endpoint: "https://gateway.example.com",
    model: "grok-4.5",
    displayName: "Grok 4.5",
  });
  assert.deepEqual(changed, [configPath]);

  const raw = await readFile(configPath, "utf8");
  assert.equal(raw.includes("kept = true"), true);
  assert.equal(raw.includes("api_key = \"test-key\""), true);
  assert.equal((await stat(configPath)).mode & 0o777, 0o600);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
});
