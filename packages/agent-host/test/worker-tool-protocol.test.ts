import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { WorkerMessagePresentResponse } from "@rah-os/protocol";

import {
  formatBodiedWakeInput,
  providerActivationInput,
  RAH_WORKER_TOOLS_ENV,
  renderStandingProtocolCard,
  runWorkerCliCommand,
  STANDING_PROTOCOL_VERSION,
  standingProtocolVersion,
  startupRulesSection,
  workerCliSection,
  workerToolModeForRuntime,
  workerToolNames,
} from "../src/index.ts";

/**
 * evo §57: only a runtime that actually carries the Loom Worker tools gets
 * the tool form of the standing protocol and of the wake `Reply:` line; the
 * other three CLIs keep the CLI form byte for byte, so their protocol
 * version (and therefore their resumed sessions) does not change.
 */
const OPENCODE = workerToolNames("opencode")!;

test("the CLI protocol is unchanged; the tool protocol has its own version", () => {
  // Pinned before the facade existed (evo HEAD 501233a).
  assert.equal(STANDING_PROTOCOL_VERSION, "8f51ca099de3");
  assert.equal(standingProtocolVersion(undefined), STANDING_PROTOCOL_VERSION);
  assert.equal(
    createHash("sha256").update(renderStandingProtocolCard()).digest("hex"),
    "433a401ceff5b4a94ff3d54163bb5baf1617b2266a5f53d3c383810b21e3725a",
  );
  const tools = standingProtocolVersion(OPENCODE);
  assert.match(tools, /^[0-9a-f]{12}$/u);
  assert.notEqual(tools, STANDING_PROTOCOL_VERSION);
  assert.deepEqual(OPENCODE, {
    post: "loom_message_post",
    check: "loom_message_check",
  });
  assert.equal(workerToolNames(undefined), undefined);
  assert.equal(workerToolNames("claude"), undefined);
});

test("the tool protocol points at the tools and drops the heredoc usage", () => {
  const cli = workerCliSection();
  const tool = workerCliSection(OPENCODE);
  assert.match(cli, /<<'RAH_MESSAGE_EOF'/u);
  assert.doesNotMatch(tool, /RAH_MESSAGE_EOF|heredoc|message-post --target/u);
  assert.match(tool, /`loom_message_post`/u);
  assert.match(tool, /`loom_message_check`/u);
  assert.match(tool, /`final`/u);
  // Everything but posting and checking stays on the Worker CLI.
  assert.match(tool, /"\$RAH_WORKER_CLI" worker task-claim-message/u);
  assert.match(tool, /help <topic>/u);
  assert.ok(tool.length < cli.length, "the tool form is not longer");
  const rules = startupRulesSection(OPENCODE);
  assert.match(rules, /`based_on_room_seq`/u);
  assert.match(rules, /`loom_message_check`/u);
  assert.doesNotMatch(rules, /--based-on-room-seq/u);
  assert.match(startupRulesSection(), /--based-on-room-seq/u);
  // The card follows the variant.
  assert.match(
    renderStandingProtocolCard(OPENCODE),
    new RegExp(`v${standingProtocolVersion(OPENCODE)}`, "u"),
  );
});

test("worker help protocol renders the variant of the Provider it runs under", async () => {
  const run = async (env: Record<string, string>) => {
    let stdout = "";
    await runWorkerCliCommand(["worker", "help", "protocol"], {
      env,
      fetch: async () => {
        throw new Error("no network");
      },
      stderr: { write: () => undefined },
      stdout: { write: (value: string) => (stdout += value) },
    });
    return stdout;
  };
  assert.equal(await run({}), `${renderStandingProtocolCard()}\n`);
  assert.equal(
    await run({ [RAH_WORKER_TOOLS_ENV]: "opencode" }),
    `${renderStandingProtocolCard(OPENCODE)}\n`,
  );
});

const M12 = "message_0c12aaaa-1111-4222-8333-444455556666";
const M14 = "message_0c14bbbb-1111-4222-8333-444455556666";
const T9 = "thread_7e09cccc-1111-4222-8333-444455556666";
const HANDLE = "AbCdEfGhIjKlMnOpQrStUv";

function event(roomSeq: number, payload: Record<string, unknown>) {
  return {
    eventId: `event-${roomSeq}`,
    roomId: "room-general",
    roomSeq,
    type: "message.posted",
    actorId: "principal-richard",
    aggregateType: "message",
    aggregateId: `aggregate-${roomSeq}`,
    payload,
    idempotencyKey: `key-${roomSeq}`,
    schemaVersion: 1,
    createdAt: "2026-09-18T09:30:00.000Z",
  };
}

function present(
  overrides: Partial<WorkerMessagePresentResponse> = {},
): WorkerMessagePresentResponse {
  return {
    fromSeq: 12,
    toSeq: 14,
    contentDigest: `sha256:${"a".repeat(64)}`,
    events: [
      event(12, { messageId: M12, body: "can you take the migration?" }),
      event(14, { messageId: M14, body: "and the rollback plan" }),
    ],
    presentedSeqs: [12, 13, 14],
    presentedThroughSeq: 14,
    noticeCount: 0,
    addressing: {
      targets: { "room-general": "#general" },
      handles: { "principal-richard": "richard" },
    },
    renderedAt: "2026-09-18T09:30:01.000Z",
    ...overrides,
  };
}

test("golden: the tool wake names the tool call and carries no handle on it", () => {
  // The CLI wake is unchanged for every other runtime.
  assert.match(
    String(formatBodiedWakeInput({ present: present() })),
    /\nReply: message-post --target "#general" --based-on-room-seq 14 --final · no reply needed: message-check$/u,
  );
  assert.equal(
    formatBodiedWakeInput({
      present: present(),
      tools: OPENCODE,
      turnHandle: HANDLE,
    }),
    [
      "#general seq 12 msg=0c12aaaa @richard: can you take the migration?",
      "#general seq 14 msg=0c14bbbb @richard: and the rollback plan",
      'Reply: loom_message_post target="#general" based_on_room_seq=14 final=true · no reply needed: loom_message_check',
    ].join("\n"),
  );
  assert.equal(
    formatBodiedWakeInput({
      present: present({
        events: [
          event(12, { messageId: M12, threadId: T9, body: "in thread" }),
          event(14, { messageId: M14, body: "in channel" }),
        ],
      }),
      tools: OPENCODE,
      turnHandle: HANDLE,
    }),
    [
      "#general:7e09cccc seq 12 msg=0c12aaaa @richard: in thread",
      "#general seq 14 msg=0c14bbbb @richard: in channel",
      'Reply per target (final=true on your last post only): loom_message_post target="#general:7e09cccc" based_on_room_seq=14 · loom_message_post target="#general" based_on_room_seq=14 · no reply needed: loom_message_check',
    ].join("\n"),
  );
  assert.match(
    String(
      formatBodiedWakeInput({
        present: present({
          presentedThroughSeq: 12,
          events: [event(12, { messageId: M12, body: "first" })],
          noticeCount: 1,
          noticeFromSeq: 14,
          noticeToSeq: 14,
        }),
        tools: OPENCODE,
        turnHandle: HANDLE,
      }),
    ),
    /\nShown through seq 12 of 14; 1 more event \(seq 14-14\) not shown: call loom_message_check first, then reply\.$/u,
  );
  const retried = String(
    formatBodiedWakeInput({
      present: present({
        previousAttemptReplyMessageId: M12,
        previousAttemptReplyFinal: true,
      }),
      tools: OPENCODE,
      turnHandle: HANDLE,
    }),
  );
  assert.match(
    retried,
    /\nPrevious attempt posted its final reply msg=0c12aaaa; confirm delivery with loom_message_check\.$/u,
  );
  assert.doesNotMatch(retried, /--turn/u);
  // The fixed startup wake keeps the CLI `--startup` form (no tool for it).
  assert.equal(
    providerActivationInput("", undefined, ""),
    "Run message-check --startup first.",
  );
});

test("only OpenCode carries the tools, and an explicit switch turns them off", () => {
  assert.equal(workerToolModeForRuntime("opencode", {}), "opencode");
  for (const runtime of ["claude", "codex", "kimi", "unknown"])
    assert.equal(workerToolModeForRuntime(runtime, {}), undefined);
  assert.equal(
    workerToolModeForRuntime("opencode", { RAH_OPENCODE_WORKER_TOOLS: "off" }),
    undefined,
  );
});
