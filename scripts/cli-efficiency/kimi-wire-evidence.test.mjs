// Kimi drift/efficiency gate evidence against the real kimi-code 0.39 ACP
// session layout. Fixture: `fixtures/kimi-acp-0.39-session/wire.jsonl` is
// the paid Kimi cold drift run of 2026-09-25 (d917f01, session
// session_c12f6837-9cc9-4cce-8a11-5a73e2521f16), trimmed to the record types
// the gate reads (prompt, tool-snapshot and message bodies removed; the
// compaction summary text replaced). The session index line mirrors the
// real `~/.kimi-code/session_index.jsonl` entry. No CLI is spawned.
import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { kimiWirePath, readKimiWire } from "./provider-files.mjs";
import {
  assertKimiRequests,
  kimiWireCompactions,
  kimiWireRound,
} from "./kimi-usage.mjs";
import { checkRoundModels } from "./drift-checks.mjs";
import { kimiCompactionObserved } from "./drift-compaction.mjs";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/kimi-acp-0.39-session/wire.jsonl",
);
const SESSION = "session_c12f6837-9cc9-4cce-8a11-5a73e2521f16";
const WORKSPACE = "wd_workspace_18691a90a5c4";
const approved = { model: "kimi-code/k3-256k", effort: "low" };

function withKimiHome(layout, fn) {
  const home = mkdtempSync(join(tmpdir(), "loom-kimi-home-"));
  const sessionDir =
    layout === "index-only"
      ? join(home, "elsewhere", SESSION)
      : join(home, "sessions", WORKSPACE, SESSION);
  if (layout !== "missing") {
    mkdirSync(join(sessionDir, "agents", "main"), { recursive: true });
    copyFileSync(FIXTURE, join(sessionDir, "agents", "main", "wire.jsonl"));
  }
  writeFileSync(
    join(home, "session_index.jsonl"),
    JSON.stringify({
      sessionId: SESSION,
      sessionDir,
      workDir: "/private/var/fixture/workspace",
    }) + "\n",
  );
  const previous = process.env.KIMI_CODE_HOME;
  process.env.KIMI_CODE_HOME = home;
  try {
    return fn({ home, sessionDir });
  } finally {
    if (previous === undefined) delete process.env.KIMI_CODE_HOME;
    else process.env.KIMI_CODE_HOME = previous;
  }
}

test("the wire of a Kimi ACP session is found by the id the product records (already session_-prefixed)", () => {
  withKimiHome("real", ({ sessionDir }) => {
    const expected = join(sessionDir, "agents", "main", "wire.jsonl");
    assert.equal(kimiWirePath(SESSION), expected);
    // A bare id (older print-mode hint) resolves to the same directory.
    assert.equal(kimiWirePath(SESSION.slice("session_".length)), expected);
  });
});

test("the session index locates a wire outside the sessions/<workspace> glob", () => {
  withKimiHome("index-only", ({ sessionDir }) => {
    assert.equal(
      kimiWirePath(SESSION),
      join(sessionDir, "agents", "main", "wire.jsonl"),
    );
  });
});

test("a missing wire stays missing evidence, never a pass", () => {
  withKimiHome("missing", () => {
    assert.throws(() => kimiWirePath(SESSION), /Expected exactly one/u);
    const verdict = checkRoundModels(
      () => kimiWireRound(readKimiWire(SESSION), {}).requests.length,
    );
    assert.equal(verdict.status, "missing");
  });
});

test("post-hoc model check verifies round 1 of the real run from its wire", () => {
  withKimiHome("real", () => {
    const verdict = checkRoundModels(() => {
      const wire = kimiWireRound(readKimiWire(SESSION), {
        from: "2026-09-25T14:03:06.661Z",
        to: "2026-09-25T14:03:16.211Z",
      });
      assertKimiRequests(wire.requests, approved);
      return wire.requests.length;
    });
    assert.deepEqual(verdict, { status: "verified", records: 3 });
  });
});

test("the forced /compact of the real run is observed from the wire even though /usage grew", () => {
  const wire = kimiWireCompactions(
    (() => {
      let text = "";
      withKimiHome("real", () => {
        text = readKimiWire(SESSION);
      });
      return text;
    })(),
    { from: "2026-09-25T14:03:51.000Z" },
  );
  assert.equal(wire.length, 1);
  assert.equal(wire[0].source, "manual");
  assert.equal(wire[0].completed, true);
  assert.equal(wire[0].tokensBefore, 28174);
  assert.equal(wire[0].tokensAfter, 27318);
  // The recorded gate state of that run: background reply, /usage 26405 →
  // 27318 (measured count before, rebased estimate after).
  const record = {
    contextBefore: 26405,
    contextAfter: 27318,
    reply: { completed: false, background: true },
  };
  assert.equal(kimiCompactionObserved(record, wire), true);
  assert.equal(
    kimiCompactionObserved(record, []),
    false,
    "without wire proof or a context drop nothing is observed",
  );
  assert.equal(
    kimiCompactionObserved(record, [{ ...wire[0], completed: false }]),
    false,
    "a begun but unfinished compaction is not observed",
  );
});

test("P102 usage is linked to the unique same-agent turn step request, not step completion", async () => {
  const { readFileSync } = await import("node:fs");
  const text = readFileSync(
    new URL("./fixtures/p102-kimi-timing.jsonl", import.meta.url),
    "utf8",
  );
  const wire = kimiWireRound(text);
  assert.deepEqual(
    wire.generations.map((g) => g.startedAt),
    [
      1791122270830, 1791122287327, 1791122309380, 1791122317992, 1791122336106,
      1791122355589, 1791122364470,
    ].map((t) => new Date(t).toISOString()),
  );
  for (const mutate of [
    (rows) => rows.filter((r) => r.type !== "llm.request"),
    (rows) => [...rows, ...rows.filter((r) => r.type === "llm.request")],
    (rows) =>
      rows.map((r) =>
        r.type === "llm.request" ? { ...r, agentId: "different" } : r,
      ),
    (rows) =>
      rows.map((r) =>
        r.event?.type === "step.begin"
          ? { ...r, event: { ...r.event, uuid: "wrong" } }
          : r,
      ),
  ]) {
    const bad = kimiWireRound(
      mutate(text.trim().split("\n").map(JSON.parse))
        .map(JSON.stringify)
        .join("\n"),
    );
    assert.ok(bad.generations.every((g) => g.startedAt === undefined));
  }
});

test("P102 exact request association counts posting generation before reply and final generation after", async () => {
  const { readFileSync } = await import("node:fs");
  const { summarizeGenerations } = await import("./metrics.mjs");
  const text = readFileSync(
    new URL("./fixtures/p102-kimi-timing.jsonl", import.meta.url),
    "utf8",
  );
  const windows = [
    [
      "2026-10-04T13:57:49.889Z",
      "2026-10-04T13:58:37.086Z",
      "2026-10-04T13:58:29.360Z",
      2,
    ],
    [
      "2026-10-04T13:58:37.096Z",
      "2026-10-04T13:59:13.628Z",
      "2026-10-04T13:58:56.087Z",
      1,
    ],
    [
      "2026-10-04T13:59:14.670Z",
      "2026-10-04T13:59:28.440Z",
      "2026-10-04T13:59:24.452Z",
      1,
    ],
  ];
  for (const [from, to, replyAt, before] of windows) {
    const generations = kimiWireRound(text, { from, to }).generations;
    const result = summarizeGenerations(generations, { replyAt });
    assert.equal(result.generationsBeforeReply, before);
    assert.equal(result.generationsAfterReply, 1);
  }
});

test("unreported native requests remain missing cost evidence, not zero-token generations", () => {
  const req = (step) => ({
    type: "llm.request",
    agentId: "main",
    kind: "loop",
    turnStep: `0.${step}`,
    time: 1000 + step,
  });
  const end = (step, reported = true) => ({
    type: "context.append_loop_event",
    agentId: "main",
    time: 2000 + step,
    event: {
      type: "step.end",
      turnId: "0",
      step,
      uuid: `step${step}`,
      ...(reported
        ? { messageId: `response${step}`, usage: { inputOther: 10, output: 2 } }
        : { finishReason: "interrupted" }),
    },
  });
  const wire = kimiWireRound(
    [req(1), end(1), req(2), end(2, false)].map(JSON.stringify).join("\n"),
  );
  assert.deepEqual(wire.requestCoverage, {
    status: "incomplete",
    requests: 2,
    matchedRequests: 1,
    unreportedRequests: 1,
    unmatchedUsageRecords: 0,
  });
  assert.equal(wire.generations.length, 1);
  assert.equal(wire.generations[0].inputTokens, 10);
  const duplicate = kimiWireRound(
    [req(1), req(1), end(1)].map(JSON.stringify).join("\n"),
  );
  assert.equal(duplicate.requestCoverage.status, "incomplete");
  assert.equal(duplicate.requestCoverage.matchedRequests, 0);
});

test("P106 seven native requests and four usage records cannot pass full cost evidence", async () => {
  const { readFileSync } = await import("node:fs");
  const { summarizeGenerations, compareRounds } = await import("./metrics.mjs");
  const wire = kimiWireRound(
    readFileSync(
      new URL("./fixtures/p106-kimi-request-coverage.jsonl", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(wire.requestCoverage, {
    status: "incomplete",
    requests: 7,
    matchedRequests: 4,
    unreportedRequests: 3,
    unmatchedUsageRecords: 0,
  });
  const metrics = summarizeGenerations(wire.generations);
  assert.equal(metrics.input, 106131);
  assert.equal(metrics.generationsTotal, 4);
  const native = { ...metrics, replySeconds: 1, toolCalls: [] };
  const rah = {
    ...native,
    requestCoverage: wire.requestCoverage,
    productUsage: {
      completeness: "complete",
      totals: {
        generations: 4,
        inputTokens: metrics.input,
        cachedInputTokens: metrics.cached,
        outputTokens: metrics.output,
      },
    },
  };
  const compared = compareRounds(native, rah);
  assert.deepEqual(compared.failures, ["usageEvidenceMissing"]);
  assert.equal(compared.measuredStatus, "missing-evidence");
});

test("native measurement carries independent request coverage without discarding recorded usage", async () => {
  const { measureKimiWire } = await import("./native-kimi.mjs");
  withKimiHome("real", ({ sessionDir }) => {
    copyFileSync(
      new URL("./fixtures/p106-kimi-request-coverage.jsonl", import.meta.url),
      join(sessionDir, "agents", "main", "wire.jsonl"),
    );
    const measured = measureKimiWire(
      SESSION,
      {
        startedAt: "2026-10-04T14:30:30Z",
        finishedAt: "2026-10-04T14:31:25Z",
        replySeconds: 1,
      },
      approved,
    );
    assert.equal(measured.requestCoverage.unreportedRequests, 3);
    assert.equal(measured.input, 106131);
    assert.equal(measured.generationsTotal, 4);
  });
});
