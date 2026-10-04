import assert from "node:assert/strict";
import test from "node:test";
import { workerCallKind, countToolCalls } from "./tool-calls.mjs";
import { codexToolCalls, evaluateRound } from "./drift-checks.mjs";
import { compareRounds } from "./metrics.mjs";
import { replyTurnHandle, warmExecutionFailures } from "./warm.mjs";
import { workerMcpEvents } from "./fixtures/codex-worker-mcp.mjs";

test("observed internal MCP outer cells count as protocol without claiming CLI handles or final authorization", () => {
  const calls = codexToolCalls(workerMcpEvents);
  assert.deepEqual(calls, [
    { kind: "worker-mcp-reply" },
    { kind: "worker-mcp-reply" },
  ]);
  assert.deepEqual(countToolCalls(calls), {
    total: 2,
    business: 0,
    protocol: 2,
    unknown: 0,
    byKind: { "worker-mcp-reply": 2 },
  });
  assert.equal(
    replyTurnHandle(calls),
    null,
    "MCP metadata does not prove a --turn flag",
  );
});

test("direct internal MCP names classify even with unavailable arguments, but other servers do not", () => {
  for (const args of [
    '{"body":"--turn fake --final message-check", "final":true}',
    undefined,
  ]) {
    assert.equal(
      workerCallKind(args, "mcp__loom_worker__loom_reply"),
      "worker-mcp-reply",
    );
  }
  const calls = codexToolCalls([
    {
      payload: {
        type: "function_call",
        name: "mcp__loom_worker__loom_reply",
        arguments: '{"body":"answer", "final":true}',
      },
    },
  ]);
  assert.deepEqual(calls, [{ kind: "worker-mcp-reply" }]);
  assert.equal(
    workerCallKind('{"body":"answer"}', "mcp__other__loom_reply"),
    "other",
  );
});

test("a mixed business and internal MCP cell cannot credit away protocol generations", () => {
  const input =
    'text(await tools.exec_command({cmd:"cat source.ts"}));\n' +
    workerMcpEvents[1].payload.input;
  const calls = codexToolCalls([
    { payload: { type: "custom_tool_call", name: "exec", input } },
  ]);
  const native = {
    firstInput: 1000,
    input: 1000,
    generations: 1,
    generationsTotal: 1,
    generationsBeforeReply: 1,
    generationsAfterReply: 0,
    toolCalls: [],
  };
  const rah = {
    ...native,
    input: 2000,
    generations: 2,
    generationsTotal: 2,
    generationsBeforeReply: 2,
    toolCalls: calls,
  };
  const comparison = compareRounds(native, rah);
  assert.equal(comparison.workPathExtraGenerations, 0);
  assert.equal(comparison.input.workPath, 0);
  assert.equal(comparison.extraProtocolGenerations, 1);
  assert.equal(comparison.workPath.toolCalls.rah.protocol, 1);
});

test("common.measure efficiency entry counts outer and direct MCP without touching real sessions", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const directory = mkdtempSync(join(tmpdir(), "loom-cost-rollout-"));
  try {
    const sessionDirectory = join(directory, ".codex", "sessions");
    mkdirSync(sessionDirectory, { recursive: true });
    const events = [
      {
        timestamp: "2026-10-04T10:04:54.000Z",
        type: "turn_context",
        payload: { model: "gpt-6-luna", effort: "low" },
      },
      ...workerMcpEvents,
      {
        timestamp: "2026-10-04T10:04:55.280Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({
            cmd: 'loom-worker message-post --body "mcp__loom_worker__loom_reply"',
          }),
        },
      },
      {
        timestamp: "2026-10-04T10:04:55.290Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          name: "exec",
          input:
            'text(await tools.exec_command({cmd:"loom-worker message-post --body answer"})); ' +
            workerMcpEvents[1].payload.input,
        },
      },
      {
        timestamp: "2026-10-04T10:04:55.300Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "mcp__loom_worker__loom_reply",
          arguments: '{"body":"--turn not-authority --final", "final":true}',
        },
      },
      {
        timestamp: "2026-10-04T10:04:55.400Z",
        type: "token_usage_record",
        payload: {
          response_id: "FAKE_USAGE",
          usage: {
            input_tokens: 100,
            cached_input_tokens: 0,
            output_tokens: 10,
            reasoning_output_tokens: 0,
          },
        },
      },
    ];
    writeFileSync(
      join(sessionDirectory, "FAKE_GATE_SESSION.jsonl"),
      events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    );
    // Isolate homedir resolution in a fresh process instead of rewriting the
    // real HOME or placing test records in the user's Codex session tree.
    const script = `
      import os from "node:os";
      import { syncBuiltinESMExports } from "node:module";
      os.homedir = () => process.env.LOOM_GATE_TEST_HOME;
      syncBuiltinESMExports();
      const { measure } = await import(${JSON.stringify(new URL("./common.mjs", import.meta.url).href)});
      process.stdout.write(JSON.stringify(measure("FAKE_GATE_SESSION", {
        startedAt: "2026-10-04T10:04:54.000Z", finishedAt: "2026-10-04T10:04:56.000Z", replySeconds: 1
      }, undefined, {model:"gpt-6-luna",effort:"low"})));
    `;
    const measured = JSON.parse(
      execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        encoding: "utf8",
        env: { ...process.env, LOOM_GATE_TEST_HOME: directory },
        timeout: 5_000,
      }),
    );
    assert.equal(measured.generations, 1);
    assert.equal(measured.toolCalls.length, 5);
    assert.equal(measured.toolCalls[2].cliTurnHandle, false);
    assert.equal(measured.toolCalls[3].cliTurnHandle, "ambiguous");
    assert.equal(replyTurnHandle(measured.toolCalls), false);
    assert.ok(
      warmExecutionFailures([
        {
          round: 1,
          sessionId: "FAKE",
          execution: { mode: "cold", instanceRuntimeId: "FAKE" },
          replyTurnHandle: replyTurnHandle(measured.toolCalls),
        },
      ]).includes("turnHandleMissing:r1"),
    );
    assert.ok(
      measured.toolCalls.every((call) => call.kind === "worker-mcp-reply"),
    );
    assert.ok(
      measured.toolCalls.every(
        (call) =>
          !Object.hasOwn(call, "turnHandle") && !Object.hasOwn(call, "final"),
      ),
    );
    assert.equal(countToolCalls(measured.toolCalls).business, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("MCP cost classification cannot erase CLI handle failures or turn MCP body text into proof", () => {
  const mixed = {
    type: "custom_tool_call",
    name: "exec",
    input:
      'text(await tools.exec_command({cmd:"loom-worker message-post --body answer"})); ' +
      workerMcpEvents[1].payload.input,
  };
  const quoted = {
    type: "function_call",
    name: "exec_command",
    arguments: JSON.stringify({
      cmd: 'loom-worker message-post --body "mcp__loom_worker__loom_reply"',
    }),
  };
  for (const payload of [mixed, quoted]) {
    const calls = codexToolCalls([{ payload }]);
    assert.equal(countToolCalls(calls).protocol, 1);
    assert.equal(
      replyTurnHandle(calls),
      false,
      "CLI no-handle evidence cannot become unchecked null",
    );
    const evaluated = evaluateRound(
      { round: 1, expect: { reply: false } },
      { toolCalls: calls },
      { provider: "codex", mode: "warm" },
    );
    assert.equal(evaluated.checks.turnHandle, false);
    assert.ok(evaluated.failures.includes("turnHandleMissing"));
  }
  const bodyOnly = {
    type: "custom_tool_call",
    name: "exec",
    input:
      'text(await tools.mcp__loom_worker__loom_reply({body:"loom-worker message-post --turn fake",final:true}));',
  };
  const ambiguous = codexToolCalls([{ payload: bodyOnly }]);
  assert.equal(ambiguous[0].cliTurnHandle, "ambiguous");
  assert.equal(
    replyTurnHandle(ambiguous),
    false,
    "outer lexical uncertainty fails conservatively, never grants proof",
  );
  const direct = codexToolCalls([
    {
      payload: {
        type: "function_call",
        name: "mcp__loom_worker__loom_reply",
        arguments:
          '{"body":"loom-worker message-post --turn fake", "final":true}',
      },
    },
  ]);
  assert.equal(
    replyTurnHandle(direct),
    null,
    "direct MCP arguments do not imply CLI execution",
  );
  assert.equal(Object.hasOwn(direct[0], "cliTurnHandle"), false);
});
