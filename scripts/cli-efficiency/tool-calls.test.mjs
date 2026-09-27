import assert from "node:assert/strict";
import test from "node:test";
import {
  countToolCalls,
  toolCallCategory,
  workerCallKind,
  workerToolCallKind,
} from "./tool-calls.mjs";
import { jsonArgs, workerCall } from "./claude-usage.mjs";

test("Worker CLI calls are protocol, other identifiable tool calls are business", () => {
  const cli = '"$RAH_WORKER_CLI" worker';
  assert.equal(workerCallKind(`${cli} message-post --final x`), "box-post");
  assert.equal(workerCallKind(`${cli} message-check`), "box-check");
  assert.equal(workerCallKind(`${cli} help message-post`), "worker-command");
  assert.equal(workerCallKind("rah worker help"), "worker-command");
  assert.equal(workerCallKind("cat ~/.rah/memory/MEMORY.md"), "memory-read");
  assert.equal(workerCallKind("nl -ba scripts/a.mjs | sed -n 1,40p"), "other");
  // A path that merely contains "worker" is not a Worker CLI call.
  assert.equal(workerCallKind("sed -n 1,9p src/worker-cli.ts"), "other");
  for (const kind of ["box-post", "box-check", "worker-command", "memory-read"])
    assert.equal(toolCallCategory({ kind }), "protocol");
  assert.equal(toolCallCategory({ kind: "other" }), "business");
});

// evo §57: the Loom Worker tool facade posts and checks through structured
// tools; those calls are protocol, never business work.
test("Loom Worker tool calls are protocol posts and checks, by tool name", () => {
  for (const name of [
    "loom_message_post",
    "mcp__loom__message_post",
    "message_post",
  ])
    assert.equal(workerToolCallKind(name), "box-post", name);
  for (const name of [
    "loom_message_check",
    "mcp__loom__message_check",
    "message_check",
  ])
    assert.equal(workerToolCallKind(name), "box-check", name);
  for (const name of ["bash", "other_message_post", "read", undefined])
    assert.equal(workerToolCallKind(name), undefined, String(name));
  const post = workerCall(
    "loom_message_post",
    jsonArgs({ target: "#main", body: "x", based_on_room_seq: 7, final: true }),
    "2026-09-27T00:00:00.000Z",
  );
  assert.deepEqual(post, {
    at: "2026-09-27T00:00:00.000Z",
    name: "loom_message_post",
    kind: "box-post",
    via: "tool",
    // The facade supplies the turn itself; no handle is ever missing.
    turnHandle: true,
    final: true,
  });
  assert.equal(toolCallCategory(post), "protocol");
  assert.equal(
    workerCall("loom_message_post", jsonArgs({ target: "#m", body: "x" }), "t")
      .final,
    false,
  );
  const check = workerCall("loom_message_check", jsonArgs({}), "t");
  assert.equal(check.kind, "box-check");
  assert.equal(check.turnHandle, true);
  // A bash call keeps its command classification.
  assert.equal(
    workerCall("bash", jsonArgs({ command: "ls -la" }), "t").kind,
    "other",
  );
});

test("a call whose category cannot be determined is unknown", () => {
  for (const args of [undefined, null, "", "   "])
    assert.equal(workerCallKind(args), "unknown");
  assert.equal(toolCallCategory({ kind: "unknown" }), "unknown");
  assert.equal(toolCallCategory({}), "unknown");
  assert.equal(toolCallCategory({ kind: "something-new" }), "unknown");
});

test("counts by category and kind; absent evidence stays null", () => {
  assert.equal(countToolCalls(undefined), null);
  assert.deepEqual(
    countToolCalls([
      { kind: "other" },
      { kind: "other" },
      { kind: "box-post" },
      { kind: "unknown" },
    ]),
    {
      total: 4,
      business: 2,
      protocol: 1,
      unknown: 1,
      byKind: { other: 2, "box-post": 1, unknown: 1 },
    },
  );
});
