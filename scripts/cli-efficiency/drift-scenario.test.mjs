import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_KINDS,
  RECALL_CODE_WORD,
  RECALL_PREFIX,
  DRIFT_ROLE_INSTRUCTIONS,
  buildDriftScenario,
  coverageGaps,
  segmentsOf,
} from "./drift-scenario.mjs";

test("default scenario covers every kind before and after each compaction", () => {
  const s = buildDriftScenario({ rounds: 20, compactAt: [8, 15] });
  assert.equal(s.length, 20);
  assert.deepEqual(coverageGaps(s, [8, 15]), []);
  for (const seg of segmentsOf(20, [8, 15])) {
    const kinds = new Set(
      s
        .filter((r) => r.round >= seg.from && r.round <= seg.to)
        .flatMap((r) => r.kinds),
    );
    assert.deepEqual(
      [...ALL_KINDS].filter((k) => !kinds.has(k)),
      [],
    );
  }
});

test("is deterministic and numbers rounds 1..N", () => {
  const a = buildDriftScenario({ rounds: 20, compactAt: [8, 15] });
  const b = buildDriftScenario({ rounds: 20, compactAt: [8, 15] });
  assert.deepEqual(a, b);
  assert.deepEqual(
    a.map((r) => r.round),
    Array.from({ length: 20 }, (_, i) => i + 1),
  );
});

test("round 1 is a room Q&A that roots the later thread; threads come after", () => {
  const s = buildDriftScenario({ rounds: 20, compactAt: [8, 15] });
  assert.equal(s[0].template, "qa");
  assert.equal(s[0].messages[0].target, "room");
  const threadRounds = s.filter((r) =>
    r.messages.some((m) => m.target === "thread"),
  );
  assert.ok(threadRounds.length >= 3);
  assert.ok(
    threadRounds.every((r) => r.round > 1 && r.expect.target === "thread"),
  );
});

test("expectations: silent kinds expect no reply; windows post two messages", () => {
  const s = buildDriftScenario({ rounds: 20, compactAt: [8, 15] });
  for (const r of s) {
    if (r.template === "fyi" || r.template === "other") {
      assert.equal(r.expect.reply, false);
      assert.equal(r.expect.format, null);
    } else assert.equal(r.expect.reply, true);
    if (r.template === "task-window") {
      assert.equal(r.messages.length, 2);
      assert.match(r.messages[0].body, /记一下/);
      assert.ok(r.messages[1].body.includes(r.expect.format.prefix));
    }
    if (r.template === "other") assert.match(r.messages[0].body, /^@other /);
    if (r.template === "fyi") assert.match(r.messages[0].body, /^【仅供参考】/);
  }
});

test("format prefixes are per round; recall rule lives only in the standing prompt", () => {
  const s = buildDriftScenario({ rounds: 20, compactAt: [8, 15] });
  const qa = s.find((r) => r.round === 9);
  assert.equal(qa.template, "qa");
  assert.equal(qa.expect.format.prefix, "R09答：");
  assert.equal(qa.expect.format.maxChars, 40);
  assert.ok(qa.messages[0].body.includes("R09答："));
  const recall = s.filter((r) => r.template === "thread-recall");
  for (const r of recall) {
    assert.equal(r.expect.format.prefix, RECALL_PREFIX);
    assert.ok(!r.messages[0].body.includes(RECALL_CODE_WORD));
    assert.ok(!r.messages[0].body.includes(RECALL_PREFIX));
  }
  assert.ok(DRIFT_ROLE_INSTRUCTIONS.includes(RECALL_CODE_WORD));
  assert.ok(DRIFT_ROLE_INSTRUCTIONS.includes("只有 Human 可以创建 Task"));
});

test("post-compaction windows start with a formatted reply, a silent round and a thread", () => {
  const s = buildDriftScenario({ rounds: 20, compactAt: [8, 15] });
  for (const c of [8, 15])
    assert.deepEqual(
      s.slice(c, c + 3).map((r) => r.template),
      ["qa", "other", "thread-recall"],
    );
});

test("rejects segments too short to cover every kind", () => {
  assert.throws(
    () => buildDriftScenario({ rounds: 12, compactAt: [8] }),
    /need ≥5/,
  );
  assert.throws(
    () => buildDriftScenario({ rounds: 20, compactAt: [3] }),
    /need ≥5/,
  );
  assert.equal(buildDriftScenario({ rounds: 6, compactAt: [] }).length, 6);
});
