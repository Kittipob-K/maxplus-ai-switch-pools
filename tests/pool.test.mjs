import assert from "node:assert/strict";
import test from "node:test";

import { PoolService } from "../dist/services/pool.js";

test("local fallback pools only expose message-compatible agents", () => {
  const pools = new PoolService().listPools();
  for (const pool of pools) {
    assert.deepEqual(
      pool.agents.map((agent) => agent.id),
      ["claude-code", "omp", "pi", "opencode"]
    );
  }
});

test("models pagination rejects a repeated cursor instead of looping forever", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(
      JSON.stringify({
        data: [{ id: `model-${requests}` }],
        has_more: true,
        last_id: "same-cursor",
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    await assert.rejects(
      new PoolService().fetchRemoteModels("key", "https://example.com/v1"),
      /repeated pagination cursor/
    );
    assert.equal(requests, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("models endpoint rejects malformed data entries", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [{ display_name: "Missing id" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  try {
    await assert.rejects(
      new PoolService().fetchRemoteModels("key", "https://example.com/v1"),
      /invalid model entry/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
