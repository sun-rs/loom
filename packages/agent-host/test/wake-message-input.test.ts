import assert from "node:assert/strict";
import test from "node:test";

import type { WorkerMessagePresentResponse } from "@rah-os/protocol";

import { withRuntimeNotice } from "../src/provider-activation-input.js";
import { formatBodiedWakeInput } from "../src/wake-message-input.ts";

const M12 = "message_0c12aaaa-1111-4222-8333-444455556666";
const M14 = "message_0c14bbbb-1111-4222-8333-444455556666";
const T9 = "thread_7e09cccc-1111-4222-8333-444455556666";
const HANDLE = "AbCdEfGhIjKlMnOpQrStUv";

function event(
  roomSeq: number,
  type: string,
  payload: Record<string, unknown>,
  actorId = "principal-richard",
) {
  return {
    eventId: `event-${roomSeq}`,
    roomId: "room-general",
    roomSeq,
    type,
    actorId,
    aggregateType: type.split(".")[0]!,
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
      event(12, "message.posted", {
        messageId: M12,
        body: "can you take the migration?",
      }),
      event(14, "message.posted", {
        messageId: M14,
        body: "and the rollback plan",
      }),
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

test("golden: a complete window is one line per message plus one reply line", () => {
  assert.equal(
    formatBodiedWakeInput({ present: present() }),
    [
      "#general seq 12 msg=0c12aaaa @richard: can you take the migration?",
      "#general seq 14 msg=0c14bbbb @richard: and the rollback plan",
      "Reply: message-post --based-on-room-seq 14 --final · no reply needed: message-check",
    ].join("\n"),
  );
});

test("golden: a warm turn carries its handle on both commands", () => {
  assert.equal(
    formatBodiedWakeInput({ present: present(), turnHandle: HANDLE }),
    [
      "#general seq 12 msg=0c12aaaa @richard: can you take the migration?",
      "#general seq 14 msg=0c14bbbb @richard: and the rollback plan",
      `Reply: message-post --turn ${HANDLE} --based-on-room-seq 14 --final · no reply needed: message-check --turn ${HANDLE}`,
    ].join("\n"),
  );
});

test("golden: a truncated window with a notice tail asks for message-check first", () => {
  assert.equal(
    formatBodiedWakeInput({
      present: present({
        toSeq: 40,
        presentedThroughSeq: 12,
        presentedSeqs: [12],
        events: [event(12, "message.posted", { messageId: M12, body: "one" })],
        noticeCount: 28,
        noticeFromSeq: 13,
        noticeToSeq: 40,
      }),
    }),
    [
      "#general seq 12 msg=0c12aaaa @richard: one",
      "Shown through seq 12 of 40; 28 more events (seq 13-40) not shown: run message-check first, then reply.",
    ].join("\n"),
  );
});

test("golden: a truncated window without a notice still asks for message-check first", () => {
  assert.equal(
    formatBodiedWakeInput({
      present: present({
        presentedThroughSeq: 12,
        presentedSeqs: [12],
        events: [event(12, "message.posted", { messageId: M12, body: "one" })],
      }),
      turnHandle: HANDLE,
    }),
    [
      "#general seq 12 msg=0c12aaaa @richard: one",
      `Shown through seq 12 of 14: run message-check --turn ${HANDLE} first, then reply.`,
    ].join("\n"),
  );
});

test("golden: a business fact keeps a compact type and its payload", () => {
  assert.equal(
    formatBodiedWakeInput({
      present: present({
        events: [
          event(12, "message.posted", { messageId: M12, body: "one" }),
          event(13, "task.cancelled", { taskId: "task-7", number: 7 }),
          event(14, "message.posted", { messageId: M14, body: "two" }),
        ],
      }),
    }),
    [
      "#general seq 12 msg=0c12aaaa @richard: one",
      '#general seq 13 task.cancelled @richard {"taskId":"task-7","number":7}',
      "#general seq 14 msg=0c14bbbb @richard: two",
      "Reply: message-post --based-on-room-seq 14 --final · no reply needed: message-check",
    ].join("\n"),
  );
});

test("golden: the Host cleanup notice rides as one bounded trailing line", () => {
  const notice =
    "Host cleanup after your previous run: 1 leftover background process was stopped.";
  assert.equal(
    withRuntimeNotice(formatBodiedWakeInput({ present: present() })!, notice),
    [
      "#general seq 12 msg=0c12aaaa @richard: can you take the migration?",
      "#general seq 14 msg=0c14bbbb @richard: and the rollback plan",
      "Reply: message-post --based-on-room-seq 14 --final · no reply needed: message-check",
      notice,
    ].join("\n"),
  );
});

test("a Thread message addresses its Thread with the short Thread ref", () => {
  const text = formatBodiedWakeInput({
    present: present({
      toSeq: 12,
      presentedThroughSeq: 12,
      presentedSeqs: [12],
      events: [
        event(12, "message.posted", {
          messageId: M12,
          threadId: T9,
          body: "in thread",
        }),
      ],
    }),
  })!;
  assert.match(
    text,
    /^#general:7e09cccc seq 12 msg=0c12aaaa @richard: in thread$/mu,
  );
});

test("a non-canonical id is rendered whole, never truncated into a wrong ref", () => {
  const text = formatBodiedWakeInput({
    present: present({
      toSeq: 12,
      presentedThroughSeq: 12,
      presentedSeqs: [12],
      events: [
        event(12, "message.posted", { messageId: "message-12", body: "x" }),
      ],
    }),
  })!;
  assert.match(text, /seq 12 msg=message-12 @richard: x/u);
});

test("per-turn overhead beyond the bodies stays within 250 chars, cold and warm", () => {
  const body = "b".repeat(250);
  const single = present({
    toSeq: 13,
    presentedThroughSeq: 13,
    presentedSeqs: [13],
    events: [event(13, "message.posted", { messageId: M12, body })],
    addressing: {
      targets: { "room-general": "#efficiency" },
      handles: { "principal-richard": "owner" },
    },
  });
  for (const turnHandle of [undefined, HANDLE]) {
    const text = formatBodiedWakeInput({
      present: single,
      ...(turnHandle === undefined ? {} : { turnHandle }),
    })!;
    assert.ok(
      text.length - body.length <= 250,
      `overhead ${String(text.length - body.length)}`,
    );
  }
});

test("nothing is confirmable when the first event degraded, so no bodied wake exists", () => {
  assert.equal(
    formatBodiedWakeInput({
      present: present({
        events: [],
        presentedSeqs: [],
        presentedThroughSeq: 0,
        noticeCount: 3,
        noticeFromSeq: 12,
        noticeToSeq: 14,
      }),
    }),
    undefined,
  );
});

test("the memory index rides the wake only when supplied", () => {
  const without = formatBodiedWakeInput({ present: present() })!;
  assert.doesNotMatch(without, /MEMORY\.md/u);
  const changed = formatBodiedWakeInput({
    present: present(),
    memory: { content: "# Memory\n- prefers rebase\n", reason: "changed" },
  })!;
  assert.match(changed, /## Complete original MEMORY\.md/u);
  assert.match(changed, /changed since this session's system snapshot/u);
  assert.ok(changed.includes("# Memory\n- prefers rebase\n"));
  assert.match(changed, /Reply: message-post --based-on-room-seq 14/u);
});
