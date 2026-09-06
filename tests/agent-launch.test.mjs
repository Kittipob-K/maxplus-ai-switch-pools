import assert from "node:assert/strict";
import test from "node:test";

import { AgentService } from "../dist/services/agent.js";
import { getAgentById } from "../dist/services/registry.js";

test("Aider launch plan uses the MaxPlus OpenAI-compatible endpoint", () => {
  const agent = getAgentById("aider");
  assert.ok(agent);

  const plan = new AgentService().createLaunchPlan(agent, {
    model: "qwen-coder",
    apiKey: "test-key",
    baseUrl: "https://gateway.example.com",
  });

  assert.equal(plan.command, "aider");
  assert.deepEqual(plan.args, ["--model", "openai/qwen-coder"]);
  assert.equal(plan.env.OPENAI_API_KEY, "test-key");
  assert.equal(plan.env.OPENAI_API_BASE, "https://gateway.example.com/v1");
});

test("Codex launch plan uses per-invocation Responses provider overrides", () => {
  const agent = getAgentById("codex");
  assert.ok(agent);

  const plan = new AgentService().createLaunchPlan(agent, {
    model: "gpt-compatible",
    apiKey: "test-key",
    baseUrl: "https://gateway.example.com",
  });

  assert.equal(plan.command, "codex");
  assert.deepEqual(plan.args, [
    "--model",
    "gpt-compatible",
    "-c",
    'model_provider="maxplus"',
    "-c",
    'model_providers.maxplus.name="MaxPlus"',
    "-c",
    'model_providers.maxplus.base_url="https://gateway.example.com/v1"',
    "-c",
    'model_providers.maxplus.env_key="MAXPLUS_API_KEY"',
    "-c",
    'model_providers.maxplus.wire_api="responses"',
  ]);
  assert.equal(plan.env.MAXPLUS_API_KEY, "test-key");
});

test("Grok Build launch plan forwards only user args and keeps the key out of the environment", () => {
  const agent = getAgentById("grok");
  assert.ok(agent);

  const originalGrokHome = process.env.GROK_HOME;
  process.env.GROK_HOME = "/inherited/grok";
  try {
    const plan = new AgentService().createLaunchPlan(agent, {
      model: "grok-4.5",
      apiKey: "test-key",
      baseUrl: "https://gateway.example.com",
      args: ["-p", "hello"],
    });

    assert.equal(plan.command, "grok");
    assert.deepEqual(plan.args, ["-p", "hello"]);
    assert.equal(plan.env.GROK_HOME, undefined);
    assert.equal(plan.env.MAXPLUS_API_KEY, undefined);
  } finally {
    if (originalGrokHome === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = originalGrokHome;
  }
});

test("launch plan removes inherited credentials before injecting Settings values", () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalBase = process.env.OPENAI_API_BASE;
  process.env.OPENAI_API_KEY = "inherited-key";
  process.env.OPENAI_API_BASE = "https://inherited.example.com";
  try {
    const agent = getAgentById("aider");
    assert.ok(agent);
    const plan = new AgentService().createLaunchPlan(agent, {
      apiKey: "settings-key",
      baseUrl: "https://settings.example.com",
    });
    assert.equal(plan.env.OPENAI_API_KEY, "settings-key");
    assert.equal(plan.env.OPENAI_API_BASE, "https://settings.example.com/v1");
  } finally {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalBase === undefined) delete process.env.OPENAI_API_BASE;
    else process.env.OPENAI_API_BASE = originalBase;
  }
});

test("missing agent executable reports an actionable installation error", async () => {
  const service = new AgentService();
  await assert.rejects(
    service.run(
      {
        id: "missing",
        name: "Missing Agent",
        command: "maxplus-command-that-does-not-exist",
        apiKeyEnvVars: [],
        baseUrlEnvVars: [],
        supportedProtocols: ["chat_completions"],
        installUrl: "https://example.com/install",
      },
      {}
    ),
    (error) =>
      error instanceof Error &&
      error.message.includes("Missing Agent is not installed") &&
      error.message.includes("https://example.com/install")
  );
});
