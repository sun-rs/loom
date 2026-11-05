import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const base = new URL(
  "../../docs/evo/evidence/2026-11-05-native-control-audit/",
  import.meta.url,
);
const json = (name) => JSON.parse(readFileSync(new URL(name, base), "utf8"));

test("retains failed attempts and all localhost native-model requests", () => {
  const attempts = json("attempts.json"),
    requests = json("request-index.json"),
    summary = json("summary.json");
  assert.equal(attempts.length, 8);
  assert.equal(requests.length, 54);
  assert.equal(
    attempts.reduce((n, x) => n + x.requests, 0),
    requests.length,
  );
  assert.equal(
    attempts.reduce((n, x) => n + x.fileReadReceipts, 0),
    27,
  );
  assert.equal(
    attempts
      .filter((x) => x.status === "failed")
      .reduce((n, x) => n + x.requests, 0),
    30,
  );
  assert.equal(summary.localhostNativeModelRequests, requests.length);
  assert.equal(summary.paidCalls, 0);
  assert.equal(summary.efficiencyOrCacheImprovementClaim, false);
});

test("successful native frames preserve the changed model and exact session across process restart", () => {
  const s = json("summary.json");
  const pi = json("pi-frames-1.json");
  const state = pi.find((x) => x.command === "get_state").data;
  assert.equal(state.sessionId, s.nativePassed.pi.sessionId);
  assert.equal(state.model.id, "fixture-alt");
  const kimi = json("kimi-frames-1.json");
  const resume = kimi.find((x) => x.id === 2).result;
  assert(
    resume.configOptions.some(
      (x) => x.id === "model" && x.currentValue === "fixture-alt",
    ),
  );
  assert(
    resume.configOptions.some(
      (x) => x.id === "thinking" && x.currentValue === "high",
    ),
  );
  for (const frame of kimi.filter((x) => x.method === "session/update"))
    assert.equal(frame.params.sessionId, s.nativePassed.kimi.sessionId);
  for (const name of ["attempt-2.json", "attempt-8.json"]) {
    const r = json(name);
    assert.equal(r.checks.length, 8);
    assert(r.exits.every((x) => x.code === 0 && x.signal === null));
  }
});

test("advertised capabilities and end_turn alone never become execution acceptance", () => {
  const agy = json("attempt-6.json");
  assert.equal(agy.initialize.agentInfo.version, "1.5.0");
  assert.equal(agy.newSession.error.code, -32000);
  assert.equal(agy.modelPromptsSent, 0);
  assert.equal(json("summary.json").agy.generationTested, false);
  const nativeErrors = json("kimi-error-evidence.json");
  assert(
    nativeErrors.some((x) => x.type === "turn.ended" && x.reason === "failed"),
  );
  assert.equal(json("attempt-3.json").status, "failed");
});
