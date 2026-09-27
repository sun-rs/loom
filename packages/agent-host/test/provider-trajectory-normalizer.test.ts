import assert from "node:assert/strict";
import test from "node:test";

import {
  kimiPromptCompletionTrajectory,
  normalizeClaudeTrajectoryEvent,
  normalizeCodexTrajectoryNotification,
  normalizeKimiTrajectoryNotification,
  normalizeOpenCodeTrajectoryEvent,
  RuntimeTrajectoryWriter,
} from "../src/provider-trajectory-normalizer.js";
import { redactTrajectoryText } from "../src/generic-process-adapter.ts";

const now = () => Date.parse("2026-08-29T08:00:00.000Z");

test("Codex reasoning has start/end activity without requiring reasoning text", () => {
  const item = {
    id: "reasoning-empty",
    type: "reasoning",
    content: ["PRIVATE"],
  };
  const start = normalizeCodexTrajectoryNotification(
    { method: "item/started", params: { item } },
    now,
  );
  const end = normalizeCodexTrajectoryNotification(
    { method: "item/completed", params: { item } },
    now,
  );
  assert.equal((start[0]?.entry as any)?.activity, "thinking");
  assert.equal((end.at(-1)?.entry as any)?.activity, "working");
  assert.equal((end.at(-1)?.entry as any)?.detailKind, "thinking_end");
  assert.doesNotMatch(JSON.stringify([start, end]), /PRIVATE/);
});

test("one Codex compaction yields exactly one compaction_finished fact (the item, not the deprecated notice)", () => {
  // Codex app-server 0.156.1 schema: `thread/compacted` is "Deprecated: Use
  // `ContextCompaction` item type instead" and may still accompany the item.
  // The console counts compaction_finished facts, so one compaction must not
  // count twice.
  const item = { id: "compact-1", type: "contextCompaction" };
  const facts = [
    { method: "item/started", params: { item, threadId: "t", turnId: "u" } },
    { method: "item/completed", params: { item, threadId: "t", turnId: "u" } },
    { method: "thread/compacted", params: { threadId: "t", turnId: "u" } },
  ].flatMap((frame) => normalizeCodexTrajectoryNotification(frame, now));
  assert.deepEqual(
    facts.map(({ entry }) => entry.kind),
    ["compaction_started", "compaction_finished"],
  );
});

test("current activity is emitted before text debounce and is not a copied transcript", () => {
  const frames: any[] = [];
  const writer = new RuntimeTrajectoryWriter((value) =>
    frames.push(JSON.parse(value)),
  );
  writer.emit([
    {
      entry: { kind: "thinking", text: "private long thought" },
      observedAt: new Date(now()).toISOString(),
    },
  ]);
  assert.equal(frames[0]?.entry.kind, "status");
  assert.equal(frames[0]?.entry.activity, "thinking");
  assert.doesNotMatch(JSON.stringify(frames[0]), /private long thought/);
  writer.emit([
    {
      entry: { kind: "text", text: "answer" },
      observedAt: new Date(now()).toISOString(),
    },
  ]);
  assert.equal(frames.at(-1)?.entry.activity, "working");
  writer.flush();
});

test("output after compaction-finished changes online back to working immediately", () => {
  const frames: any[] = [];
  const writer = new RuntimeTrajectoryWriter((value) =>
    frames.push(JSON.parse(value)),
  );
  const observedAt = new Date(now()).toISOString();
  writer.emit([
    { observedAt, entry: { kind: "compaction_started" } },
    { observedAt, entry: { kind: "compaction_finished" } },
  ]);
  writer.emit([
    { observedAt, entry: { kind: "text", text: "answer after compact" } },
  ]);
  assert.equal(frames.at(-1)?.entry.activity, "working");
  writer.flush();
});

test("Claude stream-json projects bounded activity without session or tool-result leakage", () => {
  const assistant = normalizeClaudeTrajectoryEvent(
    {
      message: {
        content: [
          { thinking: "正在分析", type: "thinking" },
          {
            id: "tool-1",
            input: { command: "npm test" },
            name: "Bash",
            type: "tool_use",
          },
        ],
      },
      session_id: "PRIVATE_CLAUDE_SESSION",
      type: "assistant",
    },
    now,
  );
  assert.equal(assistant[0]?.entry.kind, "thinking");
  assert.deepEqual(assistant[1]?.entry, {
    kind: "tool_start",
    producerFactId: "tool-1:tool-start",
    toolInput: '{"command":"npm test"}',
    toolName: "Bash",
  });
  const toolEnd = normalizeClaudeTrajectoryEvent(
    {
      message: {
        content: [
          {
            content: "PRIVATE TOOL RESULT",
            name: "Bash",
            tool_use_id: "tool-1",
            type: "tool_result",
          },
        ],
      },
      session_id: "PRIVATE_CLAUDE_SESSION",
      type: "user",
    },
    now,
  );
  assert.equal((toolEnd[0]?.entry as { detail?: string }).detail, "Bash已完成");
  assert.doesNotMatch(
    JSON.stringify([...assistant, ...toolEnd]),
    /PRIVATE_CLAUDE_SESSION|PRIVATE TOOL RESULT/u,
  );
});

test("Codex trajectory exposes public reasoning summary but never raw chain-of-thought", () => {
  const activities = normalizeCodexTrajectoryNotification(
    {
      method: "item/completed",
      params: {
        item: {
          content: ["PRIVATE_RAW_REASONING"],
          id: "reasoning-1",
          summary: ["检查了配置", "准备执行测试"],
          type: "reasoning",
        },
        threadId: "thread-1",
        turnId: "turn-1",
      },
    },
    now,
  );
  assert.deepEqual(activities, [
    {
      entry: {
        kind: "thinking",
        producerFactId: "reasoning-1:item/completed",
        text: "检查了配置\n准备执行测试",
      },
      observedAt: "2026-08-29T08:00:00.000Z",
    },
    {
      entry: {
        kind: "status",
        activity: "working",
        detailKind: "thinking_end",
        detail: "",
        producerFactId: "reasoning-1:item/completed",
      },
      observedAt: "2026-08-29T08:00:00.000Z",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(activities), /PRIVATE_RAW_REASONING/u);
  assert.deepEqual(
    normalizeCodexTrajectoryNotification(
      {
        method: "item/reasoning/textDelta",
        params: { delta: "PRIVATE_RAW_REASONING" },
      },
      now,
    ),
    [],
  );
});

test("Codex trajectory maps Provider tools and final text into Raft activity kinds", () => {
  assert.deepEqual(
    normalizeCodexTrajectoryNotification(
      {
        method: "item/started",
        params: {
          item: {
            command: "npm test",
            id: "command-1",
            type: "commandExecution",
          },
        },
      },
      now,
    )[0]?.entry,
    {
      kind: "tool_start",
      producerFactId: "command-1:item/started",
      toolInput: "npm test",
      toolName: "运行命令",
    },
  );
  assert.deepEqual(
    normalizeCodexTrajectoryNotification(
      {
        method: "item/completed",
        params: {
          item: { id: "message-1", text: "已完成", type: "agentMessage" },
        },
      },
      now,
    )[0]?.entry,
    {
      kind: "text",
      producerFactId: "message-1:item/completed",
      text: "已完成",
    },
  );
});

test("Codex interrupted turns are a stopped runtime state, not a runtime error", () => {
  assert.deepEqual(
    normalizeCodexTrajectoryNotification(
      {
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: { id: "turn-1", status: "interrupted" },
        },
      },
      now,
    )[0]?.entry,
    {
      activity: "offline",
      detail: "工作轮次结束：interrupted",
      detailKind: "stopped",
      kind: "status",
      producerFactId: "turn-1:turn/completed",
    },
  );
});

test("Kimi ACP session updates are session-fenced and normalized", () => {
  const frame = {
    method: "session/update",
    params: {
      sessionId: "session-1",
      update: {
        content: { text: "正在分析", type: "text" },
        messageId: "thought-1",
        sessionUpdate: "agent_thought_chunk",
      },
    },
  };
  assert.deepEqual(
    normalizeKimiTrajectoryNotification(frame, "foreign", now),
    [],
  );
  assert.deepEqual(
    normalizeKimiTrajectoryNotification(frame, "session-1", now)[0]?.entry,
    {
      kind: "thinking",
      producerFactId: "thought-1:agent_thought_chunk",
      text: "正在分析",
    },
  );
  assert.equal(
    kimiPromptCompletionTrajectory("end_turn", now)[0]?.entry.kind,
    "status",
  );
});

test("OpenCode events are session-fenced and preserve reasoning/tool state", () => {
  const reasoning = {
    properties: {
      part: {
        id: "reasoning-1",
        messageID: "message-1",
        sessionID: "session-1",
        text: "正在核对 Room 状态",
        type: "reasoning",
      },
      sessionID: "session-1",
    },
    type: "message.part.updated",
  };
  assert.deepEqual(
    normalizeOpenCodeTrajectoryEvent(reasoning, "foreign", now),
    [],
  );
  assert.deepEqual(
    normalizeOpenCodeTrajectoryEvent(reasoning, "session-1", now)[0]?.entry,
    {
      kind: "thinking",
      producerFactId: "reasoning-1:reasoning",
      text: "正在核对 Room 状态",
    },
  );
  assert.deepEqual(
    normalizeOpenCodeTrajectoryEvent(
      {
        properties: {
          part: {
            callID: "tool-1",
            id: "part-1",
            state: { input: { command: "npm test" }, status: "running" },
            tool: "bash",
            type: "tool",
          },
          sessionID: "session-1",
        },
        type: "message.part.updated",
      },
      "session-1",
      now,
    )[0]?.entry,
    {
      kind: "tool_start",
      producerFactId: "tool-1:tool-start",
      toolInput: '{"command":"npm test"}',
      toolName: "bash",
    },
  );
});

test("runtime trajectory writer owns monotonic producer sequence", () => {
  const frames: unknown[] = [];
  const writer = new RuntimeTrajectoryWriter((value) => {
    frames.push(JSON.parse(value));
  });
  const record = kimiPromptCompletionTrajectory("end_turn", now);
  writer.emit(record);
  writer.emit(record);
  assert.deepEqual(
    frames.map((frame: any) => frame.producerSequence),
    [1, 2],
  );
});

test("trajectory text coalesces for 350ms, flushes at boundaries, and never drops a size-limited suffix", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const frames: any[] = [];
  const writer = new RuntimeTrajectoryWriter((value) =>
    frames.push(JSON.parse(value)),
  );
  const delta = (text: string, kind: "text" | "thinking" = "text") => ({
    entry: { kind, text },
    observedAt: new Date(now()).toISOString(),
  });
  writer.emit([delta("Hello"), delta(" world")]);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].entry.activity, "working");
  t.mock.timers.tick(349);
  assert.equal(frames.length, 1, "only state, not text, bypasses debounce");
  t.mock.timers.tick(1);
  assert.equal(frames[1].entry.text, "Hello world");
  writer.emit([delta("thinking", "thinking"), delta("answer")]);
  assert.equal(frames[2].entry.activity, "thinking");
  assert.equal(frames[3].entry.text, "thinking");
  assert.equal(frames[4].entry.activity, "working");
  writer.emit(kimiPromptCompletionTrajectory("end_turn", now));
  assert.equal(frames[5].entry.text, "answer");
  assert.equal(frames[6].entry.kind, "status");
  const long = "x".repeat(4500);
  writer.emit([delta(long)]);
  writer.flush();
  assert.equal(
    frames
      .slice(8)
      .map((f) => f.entry.text)
      .join(""),
    long,
  );
  assert.equal(frames[7].entry.activity, "working");
  assert.ok(frames.slice(8).every((f) => f.entry.text.length <= 2000));
  const count = frames.length;
  t.mock.timers.tick(1000);
  assert.equal(frames.length, count);
  assert.deepEqual(
    frames.map((f) => f.producerSequence),
    frames.map((_, i) => i + 1),
  );
});

test("Kimi ACP tool kinds normalize into canonical tool names with a joined command", () => {
  const call = (update: Record<string, unknown>) =>
    normalizeKimiTrajectoryNotification(
      {
        method: "session/update",
        params: { sessionId: "kimi-session", update },
      },
      "kimi-session",
      now,
    )[0]?.entry as Record<string, unknown> | undefined;
  assert.deepEqual(
    call({
      sessionUpdate: "tool_call",
      toolCallId: "tool-exec",
      kind: "execute",
      title: "Run shell",
      rawInput: { command: ["/bin/zsh", "-lc", "ls"] },
    }),
    {
      kind: "tool_start",
      producerFactId: "tool-exec:tool_call",
      toolInput: JSON.stringify({ command: "/bin/zsh -lc ls" }),
      toolName: "bash",
    },
  );
  assert.equal(
    call({
      sessionUpdate: "tool_call",
      toolCallId: "tool-edit",
      kind: "edit",
      title: "write_file",
      rawInput: { path: "changed.txt" },
    })?.toolName,
    "edit",
  );
  assert.deepEqual(
    call({
      sessionUpdate: "tool_call",
      toolCallId: "tool-other",
      kind: "other",
      title: "自定义工具",
    }),
    {
      kind: "tool_start",
      producerFactId: "tool-other:tool_call",
      toolInput: JSON.stringify({ title: "自定义工具" }),
      toolName: "自定义工具",
    },
  );
});

test("Codex file changes surface an extractable file path alongside the change map", () => {
  assert.deepEqual(
    normalizeCodexTrajectoryNotification(
      {
        method: "item/started",
        params: {
          item: {
            changes: { "src/a.ts": { kind: "update" } },
            id: "change-1",
            type: "fileChange",
          },
        },
      },
      now,
    )[0]?.entry,
    {
      kind: "tool_start",
      producerFactId: "change-1:item/started",
      toolInput: JSON.stringify({
        filePath: "src/a.ts",
        changes: { "src/a.ts": { kind: "update" } },
      }),
      toolName: "修改文件",
    },
  );
});

test("trajectory string redaction replaces lease secrets everywhere they appear", () => {
  assert.equal(
    redactTrajectoryText("token=SECRET-VALUE and SECRET", [
      "SECRET",
      "SECRET-VALUE",
    ]),
    "token=[REDACTED] and [REDACTED]",
  );
  assert.equal(redactTrajectoryText("plain", []), "plain");
});
