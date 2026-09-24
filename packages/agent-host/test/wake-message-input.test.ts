import assert from "node:assert/strict";
import test from "node:test";

import type { WorkerMessagePresentResponse } from "@rah-os/protocol";

import {
  formatBodiedWakeInput,
  RESPONSE_TARGET_HINT,
  WAKE_CLOSING_LINE,
} from "../src/wake-message-input.ts";

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
        messageId: "message-12",
        body: "can you take the migration?",
      }),
      event(14, "message.posted", {
        messageId: "message-14",
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

test("the wake carries each body with its real Room seq, author and target", () => {
  const text = formatBodiedWakeInput({ present: present() })!;
  assert.match(
    text,
    /\[target=#general seq=12 msg=message-12 [^\]]*\] @richard: can you take the migration\?/u,
  );
  assert.match(
    text,
    /seq=14 msg=message-14 [^\]]*\] @richard: and the rollback plan/u,
  );
  // An execution-audit sequence (13) is covered but never rendered.
  assert.doesNotMatch(text, /seq=13/u);
  assert.ok(text.includes(WAKE_CLOSING_LINE));
  assert.ok(text.includes(RESPONSE_TARGET_HINT));
});

test("the confirm-through value is the presented prefix and the reply command carries it", () => {
  const text = formatBodiedWakeInput({ present: present() })!;
  assert.match(text, /through seq 14\b/u);
  assert.match(text, /worker message-post --based-on-room-seq 14`/u);
  // The bodied path drops the startup mandate but keeps the no-reply exit.
  assert.doesNotMatch(text, /--startup/u);
  assert.match(text, /no reply is needed[^\n]*worker message-check/iu);
});

test("a truncated window says more exists and asks for message-check before replying", () => {
  const text = formatBodiedWakeInput({
    present: present({
      toSeq: 40,
      presentedThroughSeq: 12,
      presentedSeqs: [12],
      events: [
        event(12, "message.posted", { messageId: "message-12", body: "one" }),
      ],
      noticeCount: 28,
      noticeFromSeq: 13,
      noticeToSeq: 40,
    }),
  })!;
  assert.match(text, /contiguous only through seq 12\b/u);
  assert.doesNotMatch(text, /--based-on-room-seq/u);
  assert.match(text, /28 further Room events in sequence range 13-40/u);
  assert.match(text, /not confirmed by replying/u);
  assert.match(text, /worker message-check` first to read the rest/u);
});

test("a business fact between messages is shown, not skipped", () => {
  const text = formatBodiedWakeInput({
    present: present({
      events: [
        event(12, "message.posted", { messageId: "message-12", body: "one" }),
        event(13, "task.cancelled", { taskId: "task-7", number: 7 }),
        event(14, "message.posted", { messageId: "message-14", body: "two" }),
      ],
    }),
  })!;
  assert.match(text, /seq=13 [^\n]*type=task\.cancelled/u);
  assert.match(text, /"taskId":"task-7"/u);
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
});
