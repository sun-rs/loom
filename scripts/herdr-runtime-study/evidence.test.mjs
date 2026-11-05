import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const base = new URL(
  "../../docs/evo/evidence/2026-11-05-herdr-runtime-study/",
  import.meta.url,
);
const json = (name) => JSON.parse(readFileSync(new URL(name, base), "utf8"));

test("request ledger includes preparation failures and every native fixture request", () => {
  const runs = json("attempts.json"),
    summary = json("free-results.json"),
    requests = json("request-index.json");
  assert.equal(runs.length, 5);
  assert.equal(
    runs.slice(0, 3).reduce((sum, x) => sum + x.requests, 0),
    0,
  );
  assert.equal(
    requests.length,
    runs.reduce((sum, x) => sum + x.requests, 0),
  );
  assert.equal(
    summary.localhostNativeCliFixtureRequests,
    requests.length + json("codex-tool-preflight.json").requests,
  );
  assert.equal(
    summary.pi.actualFileReadReceipts,
    runs.reduce((sum, x) => sum + x.actualFileReadReceipts, 0),
  );
  for (const req of requests)
    assert.match(
      req.endpoint,
      /^http:\/\/127\.0\.0\.1:\d+\/v1\/chat\/completions$/,
    );
  assert.equal(summary.paidCalls, 0);
  assert.equal(summary.tokenRatioClaimAllowed, false);
});

test("native final messages and actual tool receipts correlate with the reused projection", () => {
  const records = readFileSync(
    new URL("native-pi-interactive.jsonl", base),
    "utf8",
  )
    .trim()
    .split("\n")
    .map(JSON.parse);
  const projection = json("roamgate-projection.json");
  assert.equal(projection.nativeSessionId, records[0].id);
  assert.equal(projection.projection.session_id, records[0].id);
  let currentUser,
    toolCall,
    toolReceipt,
    finals = 0;
  for (const entry of records) {
    const m = entry.message;
    if (m?.role === "user") {
      currentUser = entry.id;
      toolCall = undefined;
      toolReceipt = undefined;
    }
    if (m?.role === "assistant" && m.stopReason === "toolUse")
      toolCall = m.content.find((x) => x.type === "toolCall").id;
    if (m?.role === "toolResult") {
      assert.equal(m.toolCallId, toolCall);
      assert.equal(m.isError, false);
      toolReceipt = entry.id;
    }
    if (m?.role === "assistant" && m.stopReason === "stop") {
      assert(currentUser && toolReceipt);
      assert.equal(entry.parentId, toolReceipt);
      finals++;
    }
  }
  assert.equal(finals, 13);
  assert.equal(finals, projection.finalCount);
  assert.equal(
    records.filter((x) => x.message?.role === "user").length,
    projection.userCount,
  );
});

test("failed Human takeover stays failed rather than becoming whole-stage acceptance", () => {
  const takeover = json("takeover.json"),
    summary = json("free-results.json"),
    runs = json("attempts.json");
  assert.match(
    takeover.controlConflict.output,
    /already has an attached client/,
  );
  assert.equal(takeover.automaticPromptResponse.code, 0);
  assert.equal(takeover.result.automaticRequestsWhileControlled, 2);
  assert.equal(runs.at(-1).status, "stopped-at-first-failure");
  assert.equal(
    summary.status,
    "research-stopped-at-first-takeover-invariant-failure",
  );
  assert(
    summary.notRun.includes(
      "temporary Core Room delivery and idempotency integration",
    ),
  );
  const seeds = runs
    .at(-1)
    .checks.filter((x) => x.id === "C-fixed-seed-observe-and-turn");
  assert.deepEqual(
    seeds.map((x) => x.seed),
    Array.from({ length: 10 }, (_, i) => i),
  );
  assert(
    seeds.every(
      (x) => x.extraObservationRequests === 0 && x.turnRequests === 2,
    ),
  );
});
