import assert from "node:assert/strict";
import test from "node:test";

import {
  ClientRoomSyncResponseSchema,
  WorkerSyncResponseSchema,
} from "../src/index.ts";

const base = {
  cursorAfter: 8,
  cursorBefore: 3,
  events: [],
  latestRoomSeq: 8,
  snapshot: null,
};

test("a Worker sync response may carry presented context alongside the window", () => {
  const parsed = WorkerSyncResponseSchema.parse({
    ...base,
    presentedContext: {
      events: [
        {
          alreadyPresented: true,
          messageId: "message-follow-up",
          presentedThroughSeq: 8,
          respondedAfter: { count: 1, messageIds: ["message-reply"] },
          roomSeq: 8,
        },
      ],
      targets: [{ presentedThroughSeq: 8, roomId: "room-1" }],
    },
  });
  assert.equal(parsed.presentedContext?.events[0]?.alreadyPresented, true);
  assert.deepEqual(parsed.presentedContext?.events[0]?.respondedAfter, {
    count: 1,
    messageIds: ["message-reply"],
  });
});

test("presented context is optional and the window shape is unchanged", () => {
  const parsed = WorkerSyncResponseSchema.parse(base);
  assert.equal(parsed.presentedContext, undefined);
  assert.equal(parsed.cursorAfter, 8);
});

test("the Worker sync response stays strict", () => {
  assert.throws(() =>
    WorkerSyncResponseSchema.parse({ ...base, presentedThroughSeq: 8 }),
  );
  assert.throws(() =>
    WorkerSyncResponseSchema.parse({
      ...base,
      presentedContext: { events: [], targets: [], extra: 1 },
    }),
  );
});

test("alreadyPresented is the only value the field may carry", () => {
  assert.throws(() =>
    WorkerSyncResponseSchema.parse({
      ...base,
      presentedContext: {
        events: [
          {
            alreadyPresented: false,
            messageId: "message-a",
            presentedThroughSeq: 8,
            respondedAfter: { count: 0, messageIds: [] },
            roomSeq: 8,
          },
        ],
        targets: [],
      },
    }),
  );
});

test("the Human client sync response does not gain worker-only fields", () => {
  assert.throws(() =>
    ClientRoomSyncResponseSchema.parse({
      ...base,
      presentedContext: { events: [], targets: [] },
    }),
  );
});
