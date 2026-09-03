import assert from "node:assert/strict";
import test from "node:test";

import {
  createMessageSelectionStore,
  resolveSelectedMessages,
  shouldExitMessageSelectionOnKeyDown,
} from "../src/message-selection-model.ts";

test("Raft selection state is scoped and exits without persisted residue", () => {
  const store = createMessageSelectionStore();
  assert.deepEqual(store.getSnapshot(), {
    active: false,
    scope: undefined,
    selectedIds: [],
  });

  store.enterRoom("room_one", ["message_two"]);
  store.toggle("message_one");
  assert.deepEqual(store.getSnapshot(), {
    active: true,
    scope: { roomId: "room_one" },
    selectedIds: ["message_one", "message_two"],
  });

  store.exit();
  assert.deepEqual(store.getSnapshot(), {
    active: false,
    scope: undefined,
    selectedIds: [],
  });
});

test("Thread selection can atomically toggle its root and loaded replies", () => {
  const store = createMessageSelectionStore();
  store.enterThread("room_one", "message_root");
  assert.deepEqual(store.getSnapshot().selectedIds, ["message_root"]);

  store.toggleWithThread("message_root", [
    "message_reply_2",
    "message_reply_1",
  ]);
  assert.deepEqual(store.getSnapshot().selectedIds, []);

  store.toggleWithThread("message_root", [
    "message_reply_2",
    "message_reply_1",
  ]);
  assert.deepEqual(store.getSnapshot().selectedIds, [
    "message_reply_1",
    "message_reply_2",
    "message_root",
  ]);
});

test("selection resolution preserves canonical order and fails closed on missing rows", () => {
  assert.deepEqual(
    resolveSelectedMessages(
      ["message_three", "message_missing", "message_one"],
      [
        { body: "three", messageId: "message_three", roomSeq: 3 },
        { body: "one", messageId: "message_one", roomSeq: 1 },
        { body: "two", messageId: "message_two", roomSeq: 2 },
      ],
    ),
    {
      messages: [
        { body: "one", messageId: "message_one", roomSeq: 1 },
        { body: "three", messageId: "message_three", roomSeq: 3 },
      ],
      unresolvedCount: 1,
    },
  );
});

test("a top modal consumes Escape before the underlying Room or Thread selection", () => {
  assert.equal(
    shouldExitMessageSelectionOnKeyDown({
      defaultPrevented: true,
      key: "Escape",
      modalOpen: false,
    }),
    false,
  );
  assert.equal(
    shouldExitMessageSelectionOnKeyDown({
      defaultPrevented: false,
      key: "Escape",
      modalOpen: true,
    }),
    false,
  );
  assert.equal(
    shouldExitMessageSelectionOnKeyDown({
      defaultPrevented: false,
      key: "Escape",
      modalOpen: false,
    }),
    true,
  );
});
