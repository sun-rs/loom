import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createCodexExecFinalOutput,
  proveCodexExecInput,
  type CodexExecFinalBinding,
  type CodexExecTerminalEvidence,
} from "../src/codex-exec-final-output.js";
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const lines = (rows: unknown[]) =>
  Buffer.from(rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
function fixture(resume = true) {
  const text = "完成：界";
  const prefix = lines([
    {
      type: "session_meta",
      payload: { id: "session", memory_mode: "disabled" },
    },
  ]);
  const delta: Record<string, any>[] = [
    { type: "event_msg", payload: { type: "task_started", turn_id: "turn" } },
    {
      type: "turn_context",
      payload: { turn_id: "turn", model: "model", effort: "low" },
    },
    {
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        call_id: "tool",
        internal_chat_message_metadata_passthrough: { turn_id: "turn" },
      },
    },
    {
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        call_id: "tool",
        internal_chat_message_metadata_passthrough: { turn_id: "turn" },
      },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        phase: "final_answer",
        id: "native-final",
        content: [{ type: "output_text", text }],
        internal_chat_message_metadata_passthrough: { turn_id: "turn" },
      },
    },
    {
      type: "event_msg",
      payload: {
        type: "task_complete",
        turn_id: "turn",
        last_agent_message: text,
      },
    },
  ];
  const frames: Record<string, any>[] = [
    { type: "thread.started", thread_id: "session" },
    { type: "turn.started" },
    {
      type: "item.started",
      item: { id: "command", type: "command_execution", status: "in_progress" },
    },
    {
      type: "item.completed",
      item: { id: "command", type: "command_execution", status: "completed" },
    },
    {
      type: "item.completed",
      item: { id: "final", type: "agent_message", text },
    },
    { type: "turn.completed", usage: {} },
  ];
  delta.splice(1, 0, {
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "wake" }],
      internal_chat_message_metadata_passthrough: {
        turn_id: "turn",
        content_item_kinds: ["user.text"],
      },
    },
  } as never);
  const binding: CodexExecFinalBinding = {
    launchId: "launch",
    ...(resume ? { expectedSessionId: "session" } : {}),
    model: "model",
    effort: "low",
    inputSha256: sha(Buffer.from("wake")),
    outputPath: "/private/run/answer",
    outputExistedBefore: false,
    rollout: resume
      ? {
          path: "/private/sessions/session.jsonl",
          root: "/private/sessions",
          byteOffset: prefix.length,
          prefixSha256: sha(prefix),
          device: "1",
          inode: "2",
        }
      : {
          root: "/private/sessions",
          byteOffset: 0,
          prefixSha256: sha(Buffer.alloc(0)),
          existingPaths: [],
        },
  };
  const evidence: CodexExecTerminalEvidence = {
    launchId: "launch",
    exitCode: 0,
    signal: null,
    stdoutComplete: true,
    stdout: lines(frames),
    output: {
      path: "/private/run/answer",
      device: "1",
      inode: "3",
      regular: true,
      symlink: false,
      bytes: Buffer.from(text + "\n"),
    },
    rollout: {
      path: "/private/sessions/session.jsonl",
      device: "1",
      inode: "2",
      regular: true,
      symlink: false,
      bytes: Buffer.concat([prefix, lines(delta)]),
    },
  };
  return { binding, evidence, prefix, delta, frames, text };
}

test("ordinary exec proves final from original launch, fresh output and exact current rollout suffix", () => {
  for (const resume of [true, false]) {
    const f = fixture(resume);
    const c = createCodexExecFinalOutput(f.binding);
    assert.deepEqual(c.settle(f.evidence), {
      sessionId: "session",
      turnId: "turn",
      nativeMessageId: "native-final",
      execItemId: "final",
      text: f.text,
      launchId: "launch",
    });
  }
});

test("binding is frozen and collector settles only once", () => {
  const f = fixture();
  const c = createCodexExecFinalOutput(f.binding);
  f.binding.expectedSessionId = "mutated";
  f.binding.rollout.prefixSha256 = "bad";
  const accepted = c.settle(f.evidence);
  assert.ok(accepted);
  assert.equal(c.settle({ ...f.evidence, exitCode: 1 }), accepted);
  assert.ok(Object.isFrozen(accepted));
  const broken = fixture();
  const closed = createCodexExecFinalOutput(broken.binding);
  assert.equal(closed.settle({ ...broken.evidence, exitCode: 1 }), undefined);
  assert.equal(closed.settle(broken.evidence), undefined);
});

test("foreign, replaced, truncated or preexisting file evidence never yields a final", () => {
  const cases: Array<(f: ReturnType<typeof fixture>) => void> = [
    (f) => {
      f.evidence.launchId = "other";
    },
    (f) => {
      f.evidence.exitCode = 1;
    },
    (f) => {
      f.evidence.signal = "SIGTERM";
    },
    (f) => {
      f.binding.outputExistedBefore = true;
    },
    (f) => {
      f.evidence.output.path += "-old";
    },
    (f) => {
      f.evidence.output.symlink = true;
    },
    (f) => {
      f.evidence.rollout.regular = false;
    },
    (f) => {
      f.evidence.rollout.path += "-old";
    },
    (f) => {
      f.evidence.rollout.inode = "replaced";
    },
    (f) => {
      f.evidence.rollout.device = "replaced";
    },
    (f) => {
      f.binding.rollout.byteOffset++;
    },
    (f) => {
      f.binding.rollout.prefixSha256 = "0".repeat(64);
    },
    (f) => {
      f.evidence.rollout.bytes = f.evidence.rollout.bytes.subarray(
        0,
        f.prefix.length - 1,
      );
    },
    (f) => {
      f.evidence.rollout.bytes = f.evidence.rollout.bytes.subarray(0, -1);
    },
    (f) => {
      f.evidence.stdout = f.evidence.stdout.subarray(0, -1);
    },
    (f) => {
      f.evidence.output.bytes = Buffer.from("different");
    },
    (f) => {
      f.binding.model = "different";
    },
    (f) => {
      f.binding.effort = "high";
    },
  ];
  for (const [i, mutate] of cases.entries()) {
    const f = fixture();
    mutate(f);
    assert.equal(
      createCodexExecFinalOutput(f.binding).settle(f.evidence),
      undefined,
      String(i),
    );
  }
});

test("first launch cannot adopt a historical or outside-root rollout", () => {
  for (const path of [
    "/private/sessions-old/session.jsonl",
    "/private/sessions/../old.jsonl",
  ]) {
    const f = fixture(false);
    f.evidence.rollout.path = path;
    assert.equal(
      createCodexExecFinalOutput(f.binding).settle(f.evidence),
      undefined,
    );
  }
  const f = fixture(false);
  f.binding.rollout.existingPaths = [f.evidence.rollout.path];
  assert.equal(
    createCodexExecFinalOutput(f.binding).settle(f.evidence),
    undefined,
  );
});

test("explicit final phase, one original native turn and completed tools are mandatory", () => {
  const mutations: Array<(rows: any[]) => void> = [
    (rows) => {
      delete rows[5].payload.phase;
    },
    (rows) => {
      rows[5].payload.phase = "commentary";
    },
    (rows) => {
      rows[5].payload.internal_chat_message_metadata_passthrough.turn_id =
        "old";
    },
    (rows) => {
      rows[6].payload.turn_id = "old";
    },
    (rows) => {
      rows[2].payload.turn_id = "old";
    },
    (rows) => {
      rows[5].payload.content = [{ type: "output_text", text: " " }];
    },
    (rows) => {
      rows[5].payload.content[0].text = "界".repeat(21846);
    },
    (rows) => {
      rows.splice(5, 0, structuredClone(rows[5]));
    },
    (rows) => {
      rows.splice(4, 1);
    },
    (rows) => {
      rows[4].payload.call_id = "foreign";
    },
    (rows) => {
      rows.push({
        type: "event_msg",
        payload: { type: "task_started", turn_id: "second" },
      });
    },
    (rows) => {
      rows[6].payload.type = "turn_aborted";
    },
    (rows) => {
      rows.splice(6, 0, { type: "event_msg", payload: { type: "error" } });
    },
    (rows) => {
      rows.push({
        type: "response_item",
        payload: { type: "custom_tool_call", call_id: "late" },
      });
    },
  ];
  for (const [i, mutate] of mutations.entries()) {
    const f = fixture();
    mutate(f.delta);
    f.evidence.rollout.bytes = Buffer.concat([f.prefix, lines(f.delta)]);
    assert.equal(
      createCodexExecFinalOutput(f.binding).settle(f.evidence),
      undefined,
      String(i),
    );
  }
});

test("exec stream errors, duplicate terminal messages and pending or late tool items fail closed", () => {
  const mutations: Array<(rows: any[]) => void> = [
    (rows) => {
      rows[0].thread_id = "foreign";
    },
    (rows) => {
      rows.splice(3, 1);
    },
    (rows) => {
      rows[3].item.status = "in_progress";
    },
    (rows) => {
      rows.splice(5, 0, structuredClone(rows[4]));
    },
    (rows) => {
      rows.splice(4, 0, { type: "error" });
    },
    (rows) => {
      rows[5].type = "turn.failed";
    },
    (rows) => {
      rows.push({
        type: "item.completed",
        item: { id: "late", type: "command_execution", status: "completed" },
      });
    },
    (rows) => {
      rows.splice(5, 0, {
        type: "item.started",
        item: { id: "late", type: "command_execution" },
      });
    },
  ];
  for (const [i, mutate] of mutations.entries()) {
    const f = fixture();
    mutate(f.frames);
    f.evidence.stdout = lines(f.frames);
    assert.equal(
      createCodexExecFinalOutput(f.binding).settle(f.evidence),
      undefined,
      String(i),
    );
  }
});

test("commentary before the proven final is allowed; malformed UTF-8 is not", () => {
  const f = fixture();
  f.frames.splice(2, 0, {
    type: "item.completed",
    item: { id: "comment", type: "agent_message", text: "Working" },
  } as never);
  f.evidence.stdout = lines(f.frames);
  assert.ok(createCodexExecFinalOutput(f.binding).settle(f.evidence));
  const malformed = fixture();
  malformed.evidence.stdout = Buffer.concat([
    Buffer.from([0xff]),
    malformed.evidence.stdout,
  ]);
  assert.equal(
    createCodexExecFinalOutput(malformed.binding).settle(malformed.evidence),
    undefined,
  );
});

test("input proof survives a failed native turn but rejects mismatched wake and incomplete capture", () => {
  const f = fixture();
  f.evidence.exitCode = 1;
  f.evidence.stdout = lines(f.frames.slice(0, 2));
  f.evidence.rollout.bytes = Buffer.concat([
    f.prefix,
    lines(f.delta.slice(0, 3)),
  ]);
  assert.deepEqual(proveCodexExecInput(f.binding, f.evidence), {
    sessionId: "session",
    turnId: "turn",
    inputSha256: f.binding.inputSha256,
  });
  assert.equal(
    createCodexExecFinalOutput(f.binding).settle(f.evidence),
    undefined,
  );
  assert.equal(
    proveCodexExecInput(
      { ...f.binding, inputSha256: sha(Buffer.from("different")) },
      f.evidence,
    ),
    undefined,
  );
  assert.equal(
    proveCodexExecInput(f.binding, { ...f.evidence, stdoutComplete: false }),
    undefined,
  );
});

test("memory policy, exact wake identity and explicit incomplete termination fail closed", () => {
  const badMemory = fixture();
  badMemory.evidence.rollout.bytes = Buffer.from(
    badMemory.evidence.rollout.bytes,
  ).map((b) => b);
  const wrongMetadata = lines([
    {
      type: "session_meta",
      payload: { id: "session", memory_mode: "enabled" },
    },
  ]);
  badMemory.binding.rollout.byteOffset = wrongMetadata.length;
  badMemory.binding.rollout.prefixSha256 = sha(wrongMetadata);
  badMemory.evidence.rollout.bytes = Buffer.concat([
    wrongMetadata,
    lines(badMemory.delta),
  ]);
  assert.equal(
    createCodexExecFinalOutput(badMemory.binding).settle(badMemory.evidence),
    undefined,
  );
  for (const field of ["finish_reason", "stop_reason", "status"]) {
    const f = fixture();
    f.delta[5]!.payload[field] = field === "status" ? "incomplete" : "length";
    f.evidence.rollout.bytes = Buffer.concat([f.prefix, lines(f.delta)]);
    assert.equal(
      createCodexExecFinalOutput(f.binding).settle(f.evidence),
      undefined,
      field,
    );
  }
  const wrongWake = fixture();
  wrongWake.binding.inputSha256 = sha(Buffer.from("another task"));
  assert.equal(
    createCodexExecFinalOutput(wrongWake.binding).settle(wrongWake.evidence),
    undefined,
  );
});

test("native final trailing newlines survive exact output and CLI-added newline", () => {
  for (const ending of ["\n", "\r\n"]) {
    for (const appended of ["", "\n", "\r\n"]) {
      const f = fixture();
      const text = f.text + ending;
      f.delta[5]!.payload.content[0].text = text;
      f.delta[6]!.payload.last_agent_message = text;
      f.frames[4]!.item.text = text;
      f.evidence.stdout = lines(f.frames);
      f.evidence.rollout.bytes = Buffer.concat([f.prefix, lines(f.delta)]);
      f.evidence.output.bytes = Buffer.from(text + appended);
      assert.equal(
        createCodexExecFinalOutput(f.binding).settle(f.evidence)?.text,
        text,
        JSON.stringify({ ending, appended }),
      );
    }
  }
  const f = fixture();
  f.evidence.output.bytes = Buffer.from(f.text + "\n\n");
  assert.equal(
    createCodexExecFinalOutput(f.binding).settle(f.evidence),
    undefined,
  );
});

test("settled failed business tools do not invalidate a successful native final", () => {
  for (const type of ["command_execution", "file_change", "mcp_tool_call"]) {
    const f = fixture();
    f.frames[2]!.item.type = type;
    Object.assign(f.frames[3]!.item, { type, status: "failed", exit_code: 1 });
    f.evidence.stdout = lines(f.frames);
    assert.equal(
      createCodexExecFinalOutput(f.binding).settle(f.evidence)?.text,
      f.text,
      type,
    );
  }
});

test("failed final, unknown failed item and unclosed failed tool remain rejected", () => {
  const mutations: Array<(f: ReturnType<typeof fixture>) => void> = [
    (f) => {
      f.frames[4]!.item.status = "failed";
    },
    (f) => {
      Object.assign(f.frames[3]!.item, {
        type: "unknown_tool",
        status: "failed",
      });
    },
    (f) => {
      f.frames[3]!.type = "item.updated";
      f.frames[3]!.item.status = "failed";
    },
    (f) => {
      f.frames[3]!.item.status = "cancelled";
    },
    (f) => {
      f.frames[3]!.item.status = "failed";
      f.frames[5]!.type = "turn.failed";
    },
    (f) => {
      f.frames[3]!.item.status = "failed";
      f.delta.splice(4, 1);
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const f = fixture();
    mutate(f);
    f.evidence.stdout = lines(f.frames);
    f.evidence.rollout.bytes = Buffer.concat([f.prefix, lines(f.delta)]);
    assert.equal(
      createCodexExecFinalOutput(f.binding).settle(f.evidence),
      undefined,
      String(index),
    );
  }
});

test("complete native proof survives in-turn recoverable error diagnostics", () => {
  const f = fixture(false);
  for (const message of [
    "Reconnecting... 2/5 (stream disconnected before completion: tls handshake eof)",
    "Reconnecting... 3/5 (request timed out)",
    "Provider emitted a diagnostic whose wording is not a completion signal",
  ]) {
    const frames = structuredClone(f.frames);
    frames.splice(2, 0, { type: "error", message });
    assert.ok(
      createCodexExecFinalOutput(f.binding).settle({
        ...f.evidence,
        stdout: lines(frames),
      }),
    );
  }
});

test("diagnostics cannot rescue incomplete, failed, foreign or late native proof", () => {
  const changes: Array<(f: ReturnType<typeof fixture>) => void> = [
    (f) => {
      f.frames[0]!.thread_id = "foreign";
    },
    (f) => {
      f.frames.pop();
    },
    (f) => {
      f.frames.at(-1)!.type = "turn.failed";
    },
    (f) => {
      f.delta.splice(-1, 0, { type: "event_msg", payload: { type: "error" } });
    },
    (f) => {
      f.delta.pop();
    },
    (f) => {
      f.frames.splice(3, 1);
    },
    (f) => {
      f.evidence.exitCode = 1;
    },
    (f) => {
      f.evidence.signal = "SIGTERM";
    },
  ];
  for (const change of changes) {
    const f = fixture();
    change(f);
    f.frames.splice(2, 0, {
      type: "error",
      message: "Reconnecting... 2/5 (request timed out)",
    });
    const suffix = lines(f.delta);
    assert.equal(
      createCodexExecFinalOutput(f.binding).settle({
        ...f.evidence,
        stdout: lines(f.frames),
        rollout: {
          ...f.evidence.rollout,
          bytes: Buffer.concat([f.prefix, suffix]),
        },
      }),
      undefined,
    );
  }
  for (const [position, frame] of [
    [0, { type: "error", message: "before start" }],
    [5, { type: "error", message: "after final" }],
    [2, { type: "error", message: "" }],
    [2, { type: "error", message: "unknown shape", code: "unverified" }],
  ] as const) {
    const f = fixture();
    f.frames.splice(position, 0, frame);
    assert.equal(
      createCodexExecFinalOutput(f.binding).settle({
        ...f.evidence,
        stdout: lines(f.frames),
      }),
      undefined,
    );
  }
});

function multipleFinals() {
  const f = fixture();
  const earlier = structuredClone(f.delta[5]!);
  earlier.payload.id = "earlier-native-final";
  earlier.payload.content[0].text = "Intermediate answer";
  f.delta.splice(3, 0, earlier);
  f.frames.splice(2, 0, {
    type: "item.completed",
    item: {
      id: "earlier-exec-final",
      type: "agent_message",
      text: "Intermediate answer",
    },
  });
  return f;
}
function settleMultiple(f: ReturnType<typeof fixture>) {
  return createCodexExecFinalOutput(f.binding).settle({
    ...f.evidence,
    stdout: lines(f.frames),
    rollout: {
      ...f.evidence.rollout,
      bytes: Buffer.concat([f.prefix, lines(f.delta)]),
    },
  });
}

test("same-turn multiple final answers select only the native last-output answer", () => {
  const f = multipleFinals();
  assert.deepEqual(settleMultiple(f), {
    launchId: "launch",
    sessionId: "session",
    turnId: "turn",
    nativeMessageId: "native-final",
    execItemId: "final",
    text: f.text,
  });
});

test("multiple final answers cannot hide foreign, repeated, incomplete or late evidence", () => {
  const mutations: Array<(f: ReturnType<typeof fixture>) => void> = [
    (f) => {
      f.delta[3]!.payload.internal_chat_message_metadata_passthrough.turn_id =
        "other";
    },
    (f) => {
      f.delta[3]!.payload.id = "native-final";
    },
    (f) => {
      f.delta[3]!.payload.status = "incomplete";
    },
    (f) => {
      f.delta[3]!.payload.content = [{ type: "output_text", text: " " }];
    },
    (f) => {
      f.frames[2]!.item.id = "final";
    },
    (f) => {
      f.delta.at(-1)!.payload.last_agent_message = "Intermediate answer";
    },
    (f) => {
      f.evidence.output.bytes = Buffer.from("Intermediate answer\n");
    },
    (f) => {
      f.frames.at(-2)!.item.text = "Unmatched terminal answer";
    },
    (f) => {
      f.delta.push(structuredClone(f.delta.at(-1)!));
    },
    (f) => {
      f.frames.push(structuredClone(f.frames.at(-1)!));
    },
    (f) => {
      f.delta.splice(-1, 0, ...structuredClone(f.delta.slice(4, 6)));
    },
    (f) => {
      f.frames.splice(-1, 0, {
        type: "item.completed",
        item: {
          id: "late-tool",
          type: "command_execution",
          status: "completed",
        },
      });
    },
  ];
  for (const [index, change] of mutations.entries()) {
    const f = multipleFinals();
    change(f);
    assert.equal(settleMultiple(f), undefined, String(index));
  }
});

test("retried final text may repeat when native and exec identities remain distinct", () => {
  const f = multipleFinals();
  f.delta[3]!.payload.content[0].text = f.text;
  f.frames[2]!.item.text = f.text;
  assert.equal(settleMultiple(f)?.nativeMessageId, "native-final");
  assert.equal(settleMultiple(f)?.execItemId, "final");
});
