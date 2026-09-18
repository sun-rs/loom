import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { attachClaudeBusyInput } from "../src/claude-busy-input.js";

function fixture(options: { resumed?: boolean; pending?: boolean } = {}) {
  const input = new PassThrough();
  const writes: string[] = [];
  const receipts: boolean[] = [];
  let sessionId: string | undefined = "session-a";
  let complete: ((error?: Error | null) => void) | undefined;
  const gate = attachClaudeBusyInput({
    input,
    resumedSession: options.resumed ?? true,
    session: () => sessionId,
    write: (text, done) => {
      writes.push(text);
      complete = done;
      if (!options.pending) done();
    },
    receipt: (frame) => receipts.push(frame.accepted),
  });
  const line = (fingerprint = "a".repeat(64), text = "Check #room") =>
    JSON.stringify({
      protocol: "rah-runtime-notice/v1",
      id: "notice",
      fingerprint,
      text,
    }) + "\n";
  return {
    gate,
    input,
    writes,
    receipts,
    line,
    send: (fingerprint?: string) => input.write(line(fingerprint)),
    settle: (error?: Error) => complete!(error),
    session: (id: string | undefined) => {
      sessionId = id;
    },
  };
}

test("a successful native write is deduplicated; a different snapshot is delivered", () => {
  const f = fixture();
  try {
    f.send();
    f.send();
    f.send("b".repeat(64));
    assert.equal(f.writes.length, 2);
    assert.equal(f.gate.writtenCount, 2);
    assert.deepEqual(f.receipts, [true, true, true]);
  } finally {
    f.gate.close();
  }
});

test("pending write is bounded and never grants premature success to a retry", () => {
  const f = fixture({ pending: true });
  try {
    f.send();
    f.send();
    assert.equal(f.writes.length, 1);
    assert.deepEqual(f.receipts, [false]);
    f.settle(new Error("pipe failed"));
    assert.deepEqual(f.receipts, [false, false]);
    f.send();
    f.settle();
    assert.equal(f.writes.length, 2);
    assert.equal(f.gate.writtenCount, 1);
    assert.deepEqual(f.receipts, [false, false, true]);
  } finally {
    f.gate.close();
  }
});

for (const terminal of ["result", "error", "cancel"]) {
  test(`Claude ${terminal} rejects an unsettled pipe write, including a late callback`, () => {
    const f = fixture({ pending: true });
    f.send();
    if (terminal === "cancel") f.gate.close();
    else f.gate.observe({ type: terminal });
    f.settle();
    f.send("b".repeat(64));
    assert.equal(f.writes.length, 1);
    assert.equal(f.gate.writtenCount, 0);
    assert.deepEqual(f.receipts, [false]);
    f.gate.close();
  });
}

test("a changed or unavailable session cannot acknowledge or receive busy input", () => {
  const f = fixture({ pending: true });
  try {
    f.send();
    f.session("wrong-session");
    f.settle();
    f.session(undefined);
    f.send();
    assert.deepEqual(f.receipts, [false, false]);
    assert.equal(f.gate.writtenCount, 0);
    assert.equal(f.writes.length, 1);
  } finally {
    f.gate.close();
  }
});

test("fresh Claude session retains the turn-end readiness fence", () => {
  const f = fixture({ resumed: false });
  try {
    f.send();
    f.gate.observe({
      type: "system",
      subtype: "init",
      session_id: "session-a",
    });
    f.gate.observe({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "t" }] },
    });
    f.send();
    f.gate.observe({ type: "result" });
    assert.equal(f.writes.length, 0);
    assert.deepEqual(f.receipts, [false, false]);
  } finally {
    f.gate.close();
  }
});

test("malformed and oversized notices do not poison the next valid input", () => {
  const f = fixture();
  try {
    f.input.write("bad json\n");
    f.input.write(f.line("invalid"));
    f.input.write(f.line("a".repeat(64), "x".repeat(6000)));
    f.input.write("x".repeat(9000));
    f.input.write(f.line());
    assert.equal(f.writes.length, 0);
    f.send();
    assert.equal(f.writes.length, 1);
    assert.deepEqual(f.receipts, [false, false, true]);
  } finally {
    f.gate.close();
  }
});

test("synchronous pipe failure remains retryable without a local notice queue", () => {
  const input = new PassThrough();
  const receipts: boolean[] = [];
  let writes = 0;
  const gate = attachClaudeBusyInput({
    input,
    resumedSession: true,
    session: () => "s",
    receipt: (frame) => receipts.push(frame.accepted),
    write: (_text, done) => {
      if (++writes === 1) throw new Error("closed pipe");
      done();
    },
  });
  try {
    const line =
      JSON.stringify({
        protocol: "rah-runtime-notice/v1",
        id: "n",
        fingerprint: "a".repeat(64),
        text: "check",
      }) + "\n";
    input.write(line);
    input.write(line);
    assert.deepEqual(receipts, [false, true]);
    assert.equal(gate.writtenCount, 1);
  } finally {
    gate.close();
  }
});
