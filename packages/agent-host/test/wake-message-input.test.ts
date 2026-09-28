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
      'Reply: message-post --target "#general" --based-on-room-seq 14 --final · no reply needed: message-check',
    ].join("\n"),
  );
});

test("golden: a warm turn carries its handle on both commands", () => {
  assert.equal(
    formatBodiedWakeInput({ present: present(), turnHandle: HANDLE }),
    [
      "#general seq 12 msg=0c12aaaa @richard: can you take the migration?",
      "#general seq 14 msg=0c14bbbb @richard: and the rollback plan",
      `Reply: message-post --target "#general" --turn ${HANDLE} --based-on-room-seq 14 --final · no reply needed: message-check --turn ${HANDLE}`,
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
      'Reply: message-post --target "#general" --based-on-room-seq 14 --final · no reply needed: message-check',
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
      'Reply: message-post --target "#general" --based-on-room-seq 14 --final · no reply needed: message-check',
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
  assert.match(
    changed,
    /Reply: message-post --target "#general" --based-on-room-seq 14/u,
  );
});

test("golden: a Thread window's reply command names that exact Thread", () => {
  assert.equal(
    formatBodiedWakeInput({
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
    }),
    [
      "#general:7e09cccc seq 12 msg=0c12aaaa @richard: in thread",
      'Reply: message-post --target "#general:7e09cccc" --based-on-room-seq 12 --final · no reply needed: message-check',
    ].join("\n"),
  );
});

test("golden: a window spanning the channel and a Thread lists one reply command per target", () => {
  assert.equal(
    formatBodiedWakeInput({
      present: present({
        events: [
          event(12, "message.posted", {
            messageId: M12,
            threadId: T9,
            body: "in thread",
          }),
          event(14, "message.posted", { messageId: M14, body: "in channel" }),
        ],
      }),
      turnHandle: HANDLE,
    }),
    [
      "#general:7e09cccc seq 12 msg=0c12aaaa @richard: in thread",
      "#general seq 14 msg=0c14bbbb @richard: in channel",
      `Reply per target (--final on your last post only): message-post --target "#general:7e09cccc" --turn ${HANDLE} --based-on-room-seq 14 · message-post --target "#general" --turn ${HANDLE} --based-on-room-seq 14 · no reply needed: message-check --turn ${HANDLE}`,
    ].join("\n"),
  );
});

test("a Room without an addressable name keeps the explicit Thread id on the reply command", () => {
  const text = formatBodiedWakeInput({
    present: present({
      toSeq: 12,
      presentedThroughSeq: 12,
      presentedSeqs: [12],
      events: [
        event(12, "message.posted", {
          messageId: M12,
          threadId: T9,
          body: "x",
        }),
      ],
      addressing: { targets: {}, handles: {} },
    }),
  })!;
  assert.match(
    text,
    new RegExp(
      `Reply: message-post --target "room-general" --thread-id ${T9} --based-on-room-seq 12 --final`,
      "u",
    ),
  );
});

test("a retry after an attempt that neither replied nor checked says so once", () => {
  const retried = formatBodiedWakeInput({
    present: present({ previousAttemptUnconfirmed: true }),
  })!;
  assert.equal(
    retried.split("\n").at(-1),
    "Previous attempt ended without a reply or message-check.",
  );
  assert.equal(retried.match(/Previous attempt ended/gu)?.length, 1);
  const first = formatBodiedWakeInput({ present: present() })!;
  assert.doesNotMatch(first, /Previous attempt/u);
});

test("a retry after a committed but unacknowledged post names it neutrally, never as a completed reply", () => {
  const messageId = "message_1f2e3d4c-0000-4000-8000-000000000000";
  const retried = formatBodiedWakeInput({
    present: present({ previousAttemptReplyMessageId: messageId }),
    turnHandle: "t1",
  })!;
  assert.equal(
    retried.split("\n").at(-1),
    "Previous attempt posted msg=1f2e3d4c; inspect it and finish any remaining work (it does not show every target was answered), or message-check --turn t1 if nothing remains.",
  );
  assert.doesNotMatch(retried, /Previous attempt ended/u);
  assert.doesNotMatch(retried, /already posted|Your reply|final reply/u);
});

test("only a previous post carrying the final-reply marker is named as the final reply", () => {
  const messageId = "message_1f2e3d4c-0000-4000-8000-000000000000";
  const retried = formatBodiedWakeInput({
    present: present({
      previousAttemptReplyMessageId: messageId,
      previousAttemptReplyFinal: true,
    }),
    turnHandle: "t1",
  })!;
  assert.equal(
    retried.split("\n").at(-1),
    "Previous attempt posted its final reply msg=1f2e3d4c; confirm delivery with message-check --turn t1.",
  );
});

test("D1-D: a retry after a committed final reply whose completion was refused names the reply, its Thread and the refusal as facts", () => {
  const messageId = "message_1f2e3d4c-0000-4000-8000-000000000000";
  const threadId = "thread_21f55c4b-0000-4000-8000-000000000000";
  const retried = formatBodiedWakeInput({
    present: present({
      previousAttemptReplyMessageId: messageId,
      previousAttemptReplyFinal: true,
      previousAttemptReplyThreadId: threadId,
      previousAttemptRefusal:
        "activation a contains unfinished Task task_9 in state in_progress",
    }),
    turnHandle: "t1",
  })!;
  assert.equal(
    retried.split("\n").at(-1),
    "Previous attempt posted its final reply msg=1f2e3d4c in thread=21f55c4b; completion was refused: activation a contains unfinished Task task_9 in state in_progress.",
  );
});

test("D1-D: a business refusal without a committed reply is stated as one fact line", () => {
  const retried = formatBodiedWakeInput({
    present: present({
      previousAttemptRefusal:
        "activation a contains unfinished Task task_9 in state in_progress",
    }),
    turnHandle: "t1",
  })!;
  assert.equal(
    retried.split("\n").at(-1),
    "Previous attempt's completion was refused: activation a contains unfinished Task task_9 in state in_progress.",
  );
});

test("contract §3 catch-up: Channel events that did not wake the instance ride first, labelled; replies target only its own events", () => {
  const wake = formatBodiedWakeInput({
    present: present({
      fromSeq: 14,
      toSeq: 14,
      catchUpFromSeq: 11,
      catchUpOmittedCount: 0,
      events: [
        event(
          11,
          "message.posted",
          { messageId: M12, body: "@bystander what about PIDs?", threadId: T9 },
          "principal-richard",
        ),
        event(14, "message.posted", {
          messageId: M14,
          body: "@worker do you agree?",
        }),
      ],
      presentedSeqs: [11, 12, 13, 14],
      presentedThroughSeq: 14,
    }),
  });
  assert.ok(wake);
  const lines = wake.split("\n");
  assert.equal(lines[0], "Since your last read (did not wake you):");
  assert.match(lines[1]!, /seq 11 .*what about PIDs\?/u);
  assert.equal(lines[2], "For you:");
  assert.match(lines[3]!, /^#general seq 14 .*do you agree\?/u);
  assert.equal(
    lines[4],
    'Reply: message-post --target "#general" --based-on-room-seq 14 --final · no reply needed: message-check',
  );
});

test("contract §3 catch-up: an older part that did not fit is stated once, not listed", () => {
  const wake = formatBodiedWakeInput({
    present: present({
      fromSeq: 14,
      toSeq: 14,
      catchUpFromSeq: 10,
      catchUpOmittedCount: 3,
      catchUpOmittedFromSeq: 5,
      catchUpOmittedToSeq: 9,
      events: [
        event(10, "message.posted", { messageId: M12, body: "older note" }),
        event(14, "message.posted", { messageId: M14, body: "now" }),
      ],
      presentedSeqs: [10, 14],
      presentedThroughSeq: 14,
    }),
  });
  assert.ok(wake);
  assert.equal(
    wake.split("\n")[0],
    "Since your last read (did not wake you; 3 older events, seq 5-9, not shown):",
  );
});

test("contract §3 catch-up: a window without catch-up renders exactly as before", () => {
  assert.equal(
    formatBodiedWakeInput({ present: present({ catchUpFromSeq: undefined }) }),
    formatBodiedWakeInput({ present: present() }),
  );
  assert.ok(
    !formatBodiedWakeInput({ present: present() })!.includes("For you:"),
  );
});

test("review P1-2: a merged range's event that did not wake the instance is background, never a reply target", () => {
  const wake = formatBodiedWakeInput({
    present: present({
      fromSeq: 12,
      toSeq: 14,
      directedSeqs: [12, 14],
      events: [
        event(12, "message.posted", { messageId: M12, body: "@worker one" }),
        event(13, "message.posted", {
          messageId: "message_0c13cccc-1111-4222-8333-444455556666",
          body: "@bystander only for you",
          threadId: T9,
        }),
        event(14, "message.posted", { messageId: M14, body: "@worker two" }),
      ],
      presentedSeqs: [12, 13, 14],
      presentedThroughSeq: 14,
    }),
  });
  assert.ok(wake);
  const lines = wake.split("\n");
  assert.equal(lines[0], "Since your last read (did not wake you):");
  assert.match(lines[1]!, /seq 13 .*only for you/u);
  assert.equal(lines[2], "For you:");
  assert.match(lines[3]!, /seq 12 .*@worker one/u);
  assert.match(lines[4]!, /seq 14 .*@worker two/u);
  assert.equal(
    lines[5],
    'Reply: message-post --target "#general" --based-on-room-seq 14 --final · no reply needed: message-check',
  );
});

test("review P2-1: omitted history is stated even when no catch-up event fitted", () => {
  const wake = formatBodiedWakeInput({
    present: present({
      fromSeq: 14,
      toSeq: 14,
      catchUpOmittedCount: 3,
      catchUpOmittedFromSeq: 9,
      catchUpOmittedToSeq: 11,
      events: [event(14, "message.posted", { messageId: M14, body: "now" })],
      presentedSeqs: [14],
      presentedThroughSeq: 14,
    }),
  });
  assert.ok(wake);
  const lines = wake.split("\n");
  assert.equal(
    lines[0],
    "Since your last read (did not wake you; 3 older events, seq 9-11, not shown):",
  );
  assert.equal(lines[1], "For you:");
  assert.match(lines[2]!, /^#general seq 14 .*now/u);
});

test("review round 2: an explicit empty directedSeqs makes every event background with no reply target", () => {
  const wake = formatBodiedWakeInput({
    present: present({ directedSeqs: [] }),
  });
  assert.ok(wake);
  assert.ok(!wake.includes("message-post --target"), wake);
  assert.match(wake, /^Since your last read \(did not wake you\):/u);
  assert.match(wake, /No message here woke you: message-check/u);
});
