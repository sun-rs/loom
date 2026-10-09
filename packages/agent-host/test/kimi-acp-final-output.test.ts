import assert from "node:assert/strict";
import test from "node:test";
import { createKimiAcpFinalOutput } from "../src/kimi-acp-final-output.js";
const wire = {
  path: "/wire",
  device: "1",
  inode: "2",
  offset: 100,
  prefixSha256: "a".repeat(64),
};
const binding = {
  launchId: "launch",
  sessionId: "session",
  promptId: 7,
  promptText: "wake",
  model: "kimi-code/k3-256k",
  effort: "low",
  wire,
};
const event = (event: Record<string, unknown>) => ({
  type: "context.append_loop_event",
  agentId: "main",
  event,
});
function records(): Record<string, unknown>[] {
  return [
    {
      type: "turn.prompt",
      agentId: "main",
      input: [{ type: "text", text: "wake" }],
    },
    event({ type: "step.begin", turnId: "3", step: 1, uuid: "step" }),
    {
      type: "llm.request",
      agentId: "main",
      kind: "loop",
      modelAlias: binding.model,
      thinkingEffort: "low",
      turnStep: "3.1",
    },
    event({
      type: "content.part",
      turnId: "3",
      step: 1,
      stepUuid: "step",
      part: { type: "text", text: "done" },
    }),
    event({
      type: "step.end",
      turnId: "3",
      step: 1,
      uuid: "step",
      finishReason: "end_turn",
      messageId: "message",
    }),
    { type: "turn.ended", agentId: "main", turnId: 3, reason: "completed" },
  ];
}
function setup() {
  const c = createKimiAcpFinalOutput(binding);
  c.observe("session", {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "done" },
  });
  return c;
}
function proof(rows: unknown[] = records()) {
  return {
    launchId: "launch",
    sessionId: "session",
    promptId: 7,
    stopReason: "end_turn",
    cancelled: false,
    wire: {
      ...wire,
      suffix: rows.map((x) => JSON.stringify(x)).join("\n") + "\n",
    },
  };
}
test("only current ACP terminal text matching immutable native suffix is a candidate", () => {
  assert.deepEqual(setup().settle(proof()), {
    launchId: "launch",
    sessionId: "session",
    turnId: "session/prompt#7",
    nativeMessageId: "message",
    text: "done",
  });
});
test("reject changed launch, session, prompt, cancel, stop and immutable prefix", () => {
  for (const change of [
    { launchId: "other" },
    { sessionId: "other" },
    { promptId: 8 },
    { cancelled: true },
    { stopReason: "cancelled" },
    { wire: { ...proof().wire, prefixSha256: "b".repeat(64) } },
    { wire: { ...proof().wire, inode: "9" } },
    { wire: { ...proof().wire, offset: 0 } },
  ])
    assert.equal(setup().settle({ ...proof(), ...change }), undefined);
});
test("reject old input, failed turn, foreign turn, truncated wire and duplicate prompt", () => {
  const xs = records();
  for (const rows of [
    [{ ...xs[0], input: [{ type: "text", text: "old" }] }, ...xs.slice(1)],
    [...xs.slice(0, -1), { ...xs.at(-1), reason: "cancelled" }],
    [...xs.slice(0, -1), { ...xs.at(-1), turnId: 4 }],
    [...xs, xs[0]],
  ])
    assert.equal(setup().settle(proof(rows)), undefined);
  assert.equal(
    setup().settle({ ...proof(), wire: { ...wire, suffix: "{bad" } }),
    undefined,
  );
});
test("pending and unknown tools reject; failed tools are terminal, not failed turns", () => {
  for (const status of [
    "pending",
    "in_progress",
    "unknown",
    "completed",
    "failed",
  ]) {
    const c = setup();
    c.observe("session", {
      sessionUpdate: "tool_call",
      toolCallId: "t",
      status: "pending",
    });
    c.observe("session", {
      sessionUpdate: "tool_call_update",
      toolCallId: "t",
      status,
    });
    c.observe("session", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "done" },
    });
    assert.equal(
      c.settle(proof()) !== undefined,
      ["completed", "failed"].includes(status),
    );
  }
});
test("wrong model/effort, absent terminal text, foreign ACP updates reject", () => {
  for (const change of [{ modelAlias: "other" }, { thinkingEffort: "high" }]) {
    const xs = records();
    xs[2] = { ...xs[2], ...change };
    assert.equal(setup().settle(proof(xs)), undefined);
  }
  const c = setup();
  c.observe("other", {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "evil" },
  });
  assert.equal(c.settle(proof()), undefined);
  assert.equal(createKimiAcpFinalOutput(binding).settle(proof()), undefined);
});

test("missing/misattributed model request and unfinished native tools cannot authorize final", () => {
  const xs = records();
  for (const rows of [
    xs.filter((x) => x.type !== "llm.request"),
    xs.map((x) => (x.type === "llm.request" ? { ...x, turnStep: "old.1" } : x)),
    [
      ...xs.slice(0, 3),
      event({ type: "tool.call", turnId: "3", step: 1, toolCallId: "pending" }),
      ...xs.slice(3),
    ],
  ])
    assert.equal(setup().settle(proof(rows)), undefined);
});
test("unknown tool state cannot be repaired into proof by later terminal update", () => {
  const c = setup();
  c.observe("session", {
    sessionUpdate: "tool_call",
    toolCallId: "t",
    status: "weird",
  });
  c.observe("session", {
    sessionUpdate: "tool_call_update",
    toolCallId: "t",
    status: "completed",
  });
  c.observe("session", {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "done" },
  });
  assert.equal(c.settle(proof()), undefined);
});

test("local compaction prose is excluded; later native work and mismatched text fail closed", () => {
  const c = setup();
  c.observe("session", {
    sessionUpdate: "agent_message_chunk",
    content: {
      type: "text",
      text: "Compaction completed.\n- Messages compacted: 2\n- Tokens before: 3\n- Tokens after: 1",
    },
  });
  assert.equal(c.settle(proof())?.text, "done");
  const xs = records();
  assert.equal(
    setup().settle(
      proof([
        ...xs,
        event({ type: "step.begin", turnId: "3", step: 2, uuid: "late" }),
      ]),
    ),
    undefined,
  );
  const mismatch = setup();
  mismatch.observe("session", {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "extra" },
  });
  assert.equal(mismatch.settle(proof()), undefined);
});

test("malformed native text is not coerced into an apparently matching final", () => {
  const xs = records();
  xs[3] = event({
    type: "content.part",
    turnId: "3",
    step: 1,
    stepUuid: "step",
    part: { type: "text" },
  });
  const c = createKimiAcpFinalOutput(binding);
  c.observe("session", {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "undefined" },
  });
  assert.equal(c.settle(proof(xs)), undefined);
});

test("real ACP terminal display delta without status preserves a known tool state", () => {
  for (const terminal of ["completed", "failed"]) {
    const c = createKimiAcpFinalOutput(binding);
    c.observe("session", {
      sessionUpdate: "tool_call",
      toolCallId: "0:file_1",
      status: "pending",
    });
    c.observe("session", {
      sessionUpdate: "tool_call_update",
      toolCallId: "0:file_1",
      status: "in_progress",
    });
    c.observe("session", {
      sessionUpdate: "tool_call_update",
      toolCallId: "0:file_1",
      content: [{ type: "terminal", terminalId: "rah-acp-terminal-1" }],
    });
    c.observe("session", {
      sessionUpdate: "tool_call_update",
      toolCallId: "0:file_1",
      status: terminal,
    });
    c.observe("session", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "done" },
    });
    assert.equal(c.settle(proof())?.text, "done");
  }
});
test("statusless display delta neither closes pending tools nor legitimizes unknown IDs", () => {
  for (const known of [false, true]) {
    const c = setup();
    if (known)
      c.observe("session", {
        sessionUpdate: "tool_call",
        toolCallId: "0:file_1",
        status: "pending",
      });
    c.observe("session", {
      sessionUpdate: "tool_call_update",
      toolCallId: "0:file_1",
      content: [{ type: "terminal", terminalId: "rah-acp-terminal-1" }],
    });
    c.observe("session", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "done" },
    });
    assert.equal(c.settle(proof()), undefined);
  }
});
