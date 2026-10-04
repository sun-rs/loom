import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readOpenCodeTiming } from "./opencode-timing.mjs";
import { summarizeGenerations } from "./metrics.mjs";
test("OpenCode response part identity joins message creation and unique stream start; missing or duplicate start stays unknown", () => {
  const dir = mkdtempSync(join(tmpdir(), "loom-oc-timing-"));
  const path = join(dir, "db");
  const db = new DatabaseSync(path);
  try {
    db.exec(
      "CREATE TABLE session(id TEXT,parent_id TEXT);CREATE TABLE message(id TEXT,session_id TEXT,data TEXT);CREATE TABLE part(id TEXT,message_id TEXT,session_id TEXT,time_created INTEGER,data TEXT);",
    );
    db.prepare("INSERT INTO session VALUES (?,NULL)").run("s");
    db.prepare("INSERT INTO message VALUES (?,?,?)").run(
      "m",
      "s",
      JSON.stringify({ role: "assistant", time: { created: 1000 } }),
    );
    const add = db.prepare("INSERT INTO part VALUES (?,?,?,?,?)");
    add.run("start", "m", "s", 2000, JSON.stringify({ type: "step-start" }));
    add.run("finish", "m", "s", 4000, JSON.stringify({ type: "step-finish" }));
    const base = {
      responseId: "finish",
      observedAt: new Date(4000).toISOString(),
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 1,
      reasoningOutputTokens: null,
    };
    const timing = readOpenCodeTiming("s", 0, 5000, path);
    assert.deepEqual(timing.get("finish"), {
      startedAfter: new Date(1000).toISOString(),
      startedBy: new Date(2000).toISOString(),
    });
    const summary = (cut) =>
      summarizeGenerations([{ ...base, ...timing.get("finish") }], {
        replyAt: new Date(cut).toISOString(),
      });
    assert.equal(summary(3000).generationsBeforeReply, 1);
    assert.equal(summary(500).generationsAfterReply, 1);
    assert.equal(summary(1500).generationsBeforeReply, null);
    add.run(
      "duplicate",
      "m",
      "s",
      2100,
      JSON.stringify({ type: "step-start" }),
    );
    assert.equal(readOpenCodeTiming("s", 0, 5000, path).has("finish"), false);
    assert.equal(readOpenCodeTiming("unrelated", 0, 5000, path).size, 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
