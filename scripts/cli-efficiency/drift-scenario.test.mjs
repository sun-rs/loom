import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_KINDS,
  RECALL_CODE_WORD,
  RECALL_PREFIX,
  DRIFT_ROLE_INSTRUCTIONS,
  driftRoleInstructions,
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

const ATTACH = {
  relativeFile: "facts/attached-secret.txt",
  passphrase: "LOOM-ATT-0123456789abcdef",
};

test("attach: one attached-read round after the five kinds of the last segment", () => {
  const s = buildDriftScenario({ rounds: 6, compactAt: [], attach: ATTACH });
  assert.equal(s.length, 6);
  assert.deepEqual(
    s.map((r) => r.template),
    ["qa", "thread-recall", "fyi", "task-window", "other", "attached-read"],
  );
  const read = s[5];
  assert.deepEqual(read.kinds, ["attached-read"]);
  assert.equal(read.messages.length, 1);
  assert.equal(read.messages[0].target, "room");
  // The relative name and "attached directory", never the absolute path or
  // the passphrase itself.
  assert.ok(read.messages[0].body.includes(ATTACH.relativeFile));
  assert.match(read.messages[0].body, /附加目录/);
  assert.ok(!read.messages[0].body.includes(ATTACH.passphrase));
  assert.ok(!read.messages[0].body.includes("/private/"));
  assert.deepEqual(read.expect, {
    reply: true,
    target: "room",
    format: null,
    attachedSecret: ATTACH.passphrase,
  });
  assert.deepEqual(coverageGaps(s, [], { attach: true }), []);
});

test("attach: with compaction the round lands after the post-compaction window", () => {
  const s = buildDriftScenario({ rounds: 11, compactAt: [5], attach: ATTACH });
  assert.deepEqual(
    s.slice(5).map((r) => r.template),
    ["qa", "other", "thread-recall", "fyi", "task-window", "attached-read"],
  );
  assert.equal(s.filter((r) => r.template === "attached-read").length, 1);
  assert.deepEqual(coverageGaps(s, [5], { attach: true }), []);
});

test("attach: every other expectation is unchanged; too short a last segment is refused", () => {
  const plain = buildDriftScenario({ rounds: 12, compactAt: [6] });
  const attached = buildDriftScenario({
    rounds: 12,
    compactAt: [6],
    attach: ATTACH,
  });
  assert.deepEqual(attached.slice(0, 11), plain.slice(0, 11));
  assert.equal(attached[11].template, "attached-read");
  assert.throws(
    () => buildDriftScenario({ rounds: 10, compactAt: [5], attach: ATTACH }),
    /attached-read round needs ≥6 rounds in the last segment/,
  );
  // Coverage reports a missing or duplicated attached-read round.
  assert.deepEqual(coverageGaps(plain, [6], { attach: true }), [
    "attached-read:count=0",
  ]);
  assert.throws(
    () =>
      buildDriftScenario({
        rounds: 6,
        compactAt: [],
        attach: { relativeFile: "/abs/secret.txt", passphrase: "x" },
      }),
    /relative file/,
  );
});

test("attach: the standing prompt admits reading attached files only when the Human asks", () => {
  assert.equal(driftRoleInstructions(), DRIFT_ROLE_INSTRUCTIONS);
  assert.equal(driftRoleInstructions(undefined), DRIFT_ROLE_INSTRUCTIONS);
  const text = driftRoleInstructions(ATTACH);
  assert.ok(text.startsWith(DRIFT_ROLE_INSTRUCTIONS));
  assert.match(text, /附加目录/);
  assert.ok(!text.includes(ATTACH.passphrase));
  assert.ok(!text.includes(ATTACH.relativeFile));
});
