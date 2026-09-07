import assert from "node:assert/strict";
import test from "node:test";
import { listAgentOptions } from "../dist/services/registry.js";

test("last launched agent is first and labelled latest", () => {
  const agents = listAgentOptions("grok");

  assert.deepEqual(agents[0], { name: "Grok Build (latest)", value: "grok" });
  assert.equal(agents.filter((agent) => agent.value === "grok").length, 1);
  assert.equal(agents[1].name, "Claude Code");
});

test("unknown last agent leaves the registered order unchanged", () => {
  const agents = listAgentOptions("retired-agent");

  assert.equal(agents[0].name, "Claude Code");
  assert.equal(agents.some((agent) => agent.name.includes("(latest)")), false);
});
