import assert from "node:assert/strict";
import test from "node:test";
import {
  countToolCalls,
  toolCallCategory,
  workerCallKind,
} from "./tool-calls.mjs";

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

test("the collision-free loom-worker command is classified like the RAH_WORKER_CLI form", () => {
  assert.equal(
    workerCallKind("loom-worker message-post --target '#x'"),
    "box-post",
  );
  assert.equal(workerCallKind("loom-worker message-check"), "box-check");
  assert.equal(workerCallKind("loom-worker help tasks"), "worker-command");
  assert.equal(
    workerCallKind("loom-worker task-claim --number 3"),
    "task-command",
  );
  assert.equal(
    workerCallKind("loom-worker room-read --target '#x'"),
    "worker-command",
  );
});

test("exact native MCP namespace is protocol but spoofed namespace is unknown", () => {
  assert.equal(
    workerCallKind("{}", "loom_reply", "mcp__loom_worker"),
    "worker-mcp-reply",
  );
  assert.equal(workerCallKind("{}", "loom_reply", "evil"), "unknown");
  assert.equal(
    workerCallKind("{}", "mcp__loom_worker__loom_reply", "evil"),
    "unknown",
  );
});
