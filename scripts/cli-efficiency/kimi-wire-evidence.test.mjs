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
