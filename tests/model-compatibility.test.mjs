import assert from "node:assert/strict";
import test from "node:test";

import { PoolService } from "../dist/services/pool.js";
import { agentSupportsModel, getAgentById } from "../dist/services/registry.js";

test("remote pools only expose agents compatible with each model protocol", () => {
  const pools = new PoolService().poolsFromRemoteModels([
    { id: "claude", apis: ["messages"] },
    { id: "gpt", apis: ["responses"] },
    { id: "qwen", apis: ["chat_completions"] },
    { id: "gemini-pro", apis: ["gemini"] },
  ]);

  assert.deepEqual(
    pools[0].agents.map((agent) => agent.id),
    ["claude-code", "omp", "pi", "opencode"]
  );
  assert.deepEqual(
    pools[1].agents.map((agent) => agent.id),
    ["omp", "pi", "codex", "grok"]
  );
  assert.deepEqual(
    pools[2].agents.map((agent) => agent.id),
    ["omp", "pi", "aider", "opencode"]
  );
  assert.deepEqual(pools[3].agents.map((agent) => agent.id), ["gemini"]);
});

test("agent compatibility can validate an explicit model override", () => {
  const codex = getAgentById("codex");
  assert.ok(codex);
  assert.equal(agentSupportsModel(codex, { id: "chat", apis: ["chat_completions"] }), false);
  assert.equal(agentSupportsModel(codex, { id: "responses", apis: ["responses"] }), true);
});

test("gemini models are only offered to the Gemini CLI adapter", () => {
  const gemini = getAgentById("gemini");
  assert.ok(gemini);
  assert.equal(agentSupportsModel(gemini, { id: "gemini-pro", apis: ["gemini"] }), true);
  assert.equal(agentSupportsModel(gemini, { id: "claude", apis: ["messages"] }), false);
});
