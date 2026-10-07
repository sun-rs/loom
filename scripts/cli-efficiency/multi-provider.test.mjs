import test from "node:test";
import assert from "node:assert/strict";
import { multiPlan } from "../test-cli-multi-channel.mjs";
import { businessLongPlan } from "../test-cli-business-long.mjs";
import { APPROVED_GATE_MODELS } from "./approved-models.mjs";
import {
  normalizeBusinessEvents,
  assertMultiProviderVersion,
} from "./multi-provider.mjs";
import { inspectBusinessToolCalls } from "./business-observation-validation.mjs";
const versions = {
  codex: "codex-cli 0.160.1",
  claude: "2.1.287 (Claude Code)",
  kimi: "0.39.1",
  opencode: "1.18.32",
};
const env = (c) => ({
  RAH_EFFICIENCY_PROVIDER: c.provider,
  RAH_EFFICIENCY_MODEL: c.model,
  RAH_EFFICIENCY_EFFORT: c.effort ?? "none",
});
test("business long manifest records every approved provider binding without widening approvals", () => {
  for (const c of APPROVED_GATE_MODELS) {
    const p = businessLongPlan(
      ["--plan", "--pair=1"],
      versions[c.provider],
      env(c),
    );
    assert.equal(p.config.provider, c.provider);
    assert.equal(p.config.model, c.model);
    assert.equal(p.config.effort, c.effort);
    assert.equal(p.nativeMemory.provider, c.provider);
    assert.equal(p.stageCount, 36);
    assert.ok(p.nativeInvocation.initial.includes(c.model));
  }
  assert.throws(
    () =>
      businessLongPlan(
        ["--plan", "--pair=1"],
        versions.codex,
        env({ provider: "codex", model: "unapproved", effort: "low" }),
      ),
    /Unapproved/,
  );
  assert.throws(
    () =>
      multiPlan(
        ["--plan"],
        versions.claude,
        undefined,
        env({ provider: "claude", model: "haiku", effort: null }),
      ),
    /profile/,
  );
  assert.throws(() => assertMultiProviderVersion("kimi", "0.40.0"), /version/);
});
const at = "2026-10-07T00:00:01.000Z";
const round = {
  startedAt: "2026-10-07T00:00:00.000Z",
  finishedAt: "2026-10-07T00:00:03.000Z",
};
const args = { body: "answer", final: true, basedOnRoomSeq: 3 };
const receipt = JSON.stringify({
  state: "published",
  messageId: "m",
  roomSeq: 4,
});
test("Claude and Kimi raw tool identities/results become auditable operations without executing code", () => {
  const inputs = {
    claude: [
      {
        type: "user",
        timestamp: at,
        message: { role: "user", content: "material" },
      },
      {
        type: "assistant",
        timestamp: at,
        message: {
          content: [
            {
              type: "tool_use",
              id: "call",
              name: "mcp__loom_worker__loom_reply",
              input: args,
            },
          ],
        },
      },
      {
        type: "user",
        timestamp: at,
        message: {
          content: [
            { type: "tool_result", tool_use_id: "call", content: receipt },
          ],
        },
      },
    ],
    kimi: [
      {
        type: "context.append_message",
        agentId: "main",
        time: Date.parse(at),
        message: {
          role: "user",
          content: [{ type: "text", text: "material" }],
        },
      },
      {
        type: "context.append_loop_event",
        agentId: "main",
        time: Date.parse(at),
        event: {
          type: "tool.call",
          toolCallId: "call",
          name: "mcp__loom_worker__loom_reply",
          args,
        },
      },
      {
        type: "context.append_loop_event",
        agentId: "main",
        time: Date.parse(at),
        event: {
          type: "tool.result",
          toolCallId: "call",
          result: { output: receipt },
        },
      },
    ],
  };
  for (const [provider, rows] of Object.entries(inputs)) {
    const xs = normalizeBusinessEvents(provider, rows);
    assert.equal(xs.filter((x) => x.payload.role === "user").length, 1);
    assert.equal(inspectBusinessToolCalls(xs, round).attemptedCalls, 1);
    assert.ok(JSON.stringify(xs).includes("material"));
  }
});
test("normalized shell retains safety validation and unknown writes stop", () => {
  const rows = [
    {
      type: "assistant",
      timestamp: at,
      message: {
        content: [
          {
            type: "tool_use",
            id: "x",
            name: "Bash",
            input: { command: "rm -rf /tmp/not-authorized" },
          },
        ],
      },
    },
    {
      type: "user",
      timestamp: at,
      message: {
        content: [{ type: "tool_result", tool_use_id: "x", content: "done" }],
      },
    },
  ];
  assert.throws(
    () =>
      inspectBusinessToolCalls(normalizeBusinessEvents("claude", rows), round),
    /unregistered shell/,
  );
  rows[0].message.content[0] = {
    type: "tool_use",
    id: "x",
    name: "mcp__loom_worker__loom_reply",
    input: args,
  };
  rows[1].message.content[0].content = JSON.stringify({
    error: { code: "RESULT_UNKNOWN" },
  });
  assert.throws(
    () =>
      inspectBusinessToolCalls(normalizeBusinessEvents("claude", rows), round),
    /unknown write/,
  );
  assert.throws(
    () =>
      normalizeBusinessEvents("claude", [
        {
          ...rows[0],
          message: { content: [{ type: "new-tool-shape", command: "bad" }] },
        },
      ]),
    /Unknown/,
  );
  assert.throws(
    () =>
      normalizeBusinessEvents("kimi", [
        {
          type: "context.append_loop_event",
          agentId: "main",
          time: Date.parse(at),
          event: { type: "tool.future", command: "bad" },
        },
      ]),
    /Unknown/,
  );
});
test("OpenCode parts preserve completed tool call IDs and reject unfinished or unknown operations", () => {
  const rows = [
    { timestamp: at, role: "user", part: { type: "text", text: "material" } },
    {
      timestamp: at,
      role: "assistant",
      part: {
        type: "tool",
        callID: "x",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "pwd" },
          output: "/tmp",
        },
      },
    },
  ];
  const xs = normalizeBusinessEvents("opencode", rows);
  assert.equal(inspectBusinessToolCalls(xs, round).attemptedCalls, 1);
  assert.throws(
    () =>
      normalizeBusinessEvents("opencode", [
        { ...rows[1], part: { ...rows[1].part, state: { status: "running" } } },
      ]),
    /unfinished/,
  );
  assert.throws(
    () =>
      normalizeBusinessEvents("opencode", [
        { ...rows[1], part: { type: "future-operation" } },
      ]),
    /Unknown/,
  );
});

test("known foreground shell display/timeout options do not lose authority checks; background true remains blocked", () => {
  const make = (input) => [
    {
      type: "assistant",
      timestamp: at,
      message: {
        content: [{ type: "tool_use", id: "x", name: "Bash", input }],
      },
    },
    {
      type: "user",
      timestamp: at,
      message: {
        content: [{ type: "tool_result", tool_use_id: "x", content: "/tmp" }],
      },
    },
  ];
  assert.equal(
    inspectBusinessToolCalls(
      normalizeBusinessEvents(
        "claude",
        make({
          command: "pwd",
          description: "where",
          timeout: 120000,
          run_in_background: false,
        }),
      ),
      round,
    ).attemptedCalls,
    1,
  );
  for (const input of [
    { command: "pwd", run_in_background: true },
    { command: "pwd", timeout: "later" },
    { command: "pwd", workdir: "/secret" },
  ])
    assert.throws(
      () => normalizeBusinessEvents("claude", make(input)),
      /shell/,
    );
});
