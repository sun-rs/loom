import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { attachClaudeBusyInput } from "../src/claude-busy-input.js";

function fixture() {
  const input = new PassThrough();
  const writes: string[] = [];
  const receipts: { accepted: boolean }[] = [];
  const gate = attachClaudeBusyInput({
    input,
    resumedSession: true,
    session: () => "session-a",
    write: (text: string, done: (error?: Error) => void) => {
      writes.push(text);
      done();
    },
    receipt: (frame: { accepted: boolean }) => receipts.push(frame),
  });
  const send = (fingerprint = "a".repeat(64), id = "notice-1") =>
    input.write(
      JSON.stringify({
        protocol: "rah-runtime-notice/v1",
        id,
        fingerprint,
        text: "Check #room",
      }) + "\n",
    );
  const tool = (id: string) =>
    gate.observe({
      type: "assistant",
      message: { content: [{ type: "tool_use", id }] },
    });
  const done = (id: string) =>
    gate.observe({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: id }] },
    });
  return { gate, writes, receipts, send, tool, done };
}

test("Claude queues transport notice until all parallel tools finish, then writes exact session user envelope once", () => {
  const f = fixture();
  try {
    f.tool("a");
    f.tool("b");
    f.send();
    assert.equal(f.writes.length, 0);
    f.done("a");
    f.done("a");
    assert.equal(f.writes.length, 0);
    f.done("b");
    assert.equal(f.writes.length, 1);
    assert.deepEqual(JSON.parse(f.writes[0]!), {
      type: "user",
      session_id: "session-a",
      message: {
        role: "user",
        content: [{ type: "text", text: "Check #room" }],
      },
    });
    f.send();
    assert.equal(f.writes.length, 1);
    assert.deepEqual(
      f.receipts.map((x) => x.accepted),
      [true, true],
    );
  } finally {
    f.gate.close();
  }
});

test("compaction suppresses tool-boundary write; end of compaction releases it", () => {
  const f = fixture();
  try {
    f.tool("a");
    f.send();
    f.gate.observe({ type: "system", subtype: "status", status: "compacting" });
    f.done("a");
    assert.equal(f.writes.length, 0);
    f.gate.observe({ type: "system", subtype: "compact_boundary" });
    assert.equal(f.writes.length, 1);
  } finally {
    f.gate.close();
  }
});

test("terminal rejects waiting input and never injects into a completed turn", () => {
  const f = fixture();
  f.tool("a");
  f.send();
  f.gate.observe({ type: "result" });
  f.done("a");
  assert.equal(f.writes.length, 0);
  assert.deepEqual(
    f.receipts.map((x) => x.accepted),
    [false],
  );
  f.gate.close();
});

test("notice without a boundary expires without a write, allowing durable follow-up", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    f.send();
    context.mock.timers.tick(5001);
    assert.equal(f.writes.length, 0);
    assert.deepEqual(
      f.receipts.map((x) => x.accepted),
      [false],
    );
  } finally {
    f.gate.close();
  }
});

test("failed pipe write is never remembered as delivered; retry writes again", () => {
  const input = new PassThrough();
  let calls = 0;
  const receipts: boolean[] = [];
  const gate = attachClaudeBusyInput({
    input,
    resumedSession: true,
    session: () => "session-a",
    receipt: (f) => receipts.push(f.accepted),
    write: (_text, done) => {
      calls++;
      if (calls === 1) throw new Error("closed pipe");
      done();
    },
  });
  const send = () =>
    input.write(
      JSON.stringify({
        protocol: "rah-runtime-notice/v1",
        id: "n",
        fingerprint: "b".repeat(64),
        text: "check",
      }) + "\n",
    );
  const boundary = () => {
    gate.observe({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "t" }] },
    });
    gate.observe({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "t" }] },
    });
  };
  try {
    send();
    boundary();
    send();
    boundary();
    assert.equal(calls, 2);
    assert.deepEqual(receipts, [false, true]);
    assert.equal(gate.writtenCount, 1);
  } finally {
    gate.close();
  }
});

test("an immediately following notice uses the tool boundary, but assistant continuation closes it", () => {
  const f = fixture();
  try {
    f.tool("a");
    f.done("a");
    f.send();
    assert.equal(f.writes.length, 1);
  } finally {
    f.gate.close();
  }
  const g = fixture();
  try {
    g.tool("a");
    g.done("a");
    g.gate.observe({
      type: "assistant",
      message: { content: [{ type: "text", text: "continuing" }] },
    });
    g.send();
    assert.equal(g.writes.length, 0);
  } finally {
    g.gate.close();
  }
});

test("pending pipe callback does not grant premature success to a duplicate", () => {
  const input = new PassThrough();
  let complete: ((error?: Error | null) => void) | undefined;
  const receipts: boolean[] = [];
  const gate = attachClaudeBusyInput({
    input,
    resumedSession: true,
    session: () => "s",
    receipt: (f) => receipts.push(f.accepted),
    write: (_text, done) => {
      complete = done;
    },
  });
  const send = () =>
    input.write(
      JSON.stringify({
        protocol: "rah-runtime-notice/v1",
        id: "n",
        fingerprint: "c".repeat(64),
        text: "check",
      }) + "\n",
    );
  try {
    send();
    gate.observe({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "t" }] },
    });
    gate.observe({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "t" }] },
    });
    send();
    assert.deepEqual(receipts, [false]);
    complete!(new Error("pipe failed"));
    assert.deepEqual(receipts, [false, false]);
    assert.equal(gate.writtenCount, 0);
  } finally {
    gate.close();
  }
});

test("boundary after parent receipt timeout still consumes the refreshed single pending notice", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    f.tool("a");
    f.send();
    context.mock.timers.tick(1600);
    f.send();
    context.mock.timers.tick(1000);
    f.done("a");
    assert.equal(f.writes.length, 1);
    assert.equal(f.receipts.at(-1)?.accepted, true);
  } finally {
    f.gate.close();
  }
});

test("new snapshot replaces the old; a late successful receipt can be retrieved by a new request", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    f.tool("a");
    f.send();
    context.mock.timers.tick(1600);
    f.send("b".repeat(64), "replacement");
    f.done("a");
    f.send("b".repeat(64), "receipt-retry");
    assert.equal(f.writes.length, 1);
    assert.deepEqual(
      f.receipts.map((x) => x.accepted),
      [false, true, true],
    );
  } finally {
    f.gate.close();
  }
});

test("no refresh for five seconds revokes the candidate before a late tool boundary", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    f.tool("a");
    f.send();
    context.mock.timers.tick(5001);
    f.done("a");
    assert.equal(f.writes.length, 0);
  } finally {
    f.gate.close();
  }
});

test("fresh Claude session rejects busy admission before first result despite known id and finished tools", () => {
  const input = new PassThrough();
  const writes: string[] = [];
  const receipts: boolean[] = [];
  const gate = attachClaudeBusyInput({
    input,
    resumedSession: false,
    session: () => "fresh",
    write: (text, done) => {
      writes.push(text);
      done();
    },
    receipt: (frame) => receipts.push(frame.accepted),
  });
  try {
    input.write(
      JSON.stringify({
        protocol: "rah-runtime-notice/v1",
        id: "new",
        fingerprint: "d".repeat(64),
        text: "new work",
      }) + "\n",
    );
    gate.observe({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "t" }] },
    });
    gate.observe({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "t" }] },
    });
    assert.equal(writes.length, 0);
    assert.deepEqual(receipts, [false]);
    gate.observe({ type: "result" });
    assert.equal(
      writes.length,
      0,
      "finite RAH run hands pending work to follow-up, not a closing stdin",
    );
  } finally {
    gate.close();
  }
});
