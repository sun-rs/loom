import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  roomActivityMuted,
  roomAllMessagesNotified,
  roomLongMessagesCollapsed,
  setRoomPreference,
} from "../src/room-preferences.ts";

test("Room personal preferences keep Raft's collapse default and explicit mute", () => {
  assert.equal(roomActivityMuted([], "room-a"), false);
  assert.equal(roomActivityMuted(undefined, "room-a"), false);
  assert.equal(roomActivityMuted(["room:room-a"], "room-a"), true);
  assert.equal(roomAllMessagesNotified([], "room-a"), false);
  assert.equal(roomAllMessagesNotified(undefined, "room-a"), false);
  assert.equal(roomAllMessagesNotified(["room:room-a"], "room-a"), true);
  assert.equal(roomLongMessagesCollapsed([], "room-a"), true);
  assert.equal(roomLongMessagesCollapsed(undefined, "room-a"), true);
  assert.equal(roomLongMessagesCollapsed(["room:room-a"], "room-a"), false);
});

test("Room preference mutation is stable, deduplicated and reversible", () => {
  assert.deepEqual(setRoomPreference([], "room-a", true), ["room:room-a"]);
  assert.deepEqual(setRoomPreference(["room:room-a"], "room-a", true), [
    "room:room-a",
  ]);
  assert.deepEqual(
    setRoomPreference(["room:room-a", "room:room-b"], "room-a", false),
    ["room:room-b"],
  );
});

test("Room long-message preference keeps the current Raft wording", () => {
  const source = readFileSync(
    new URL("../src/components/room-dialogs.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /超过预览高度的消息折叠在「显示更多」开关后。关闭后此频道的长消息始终完整显示。/u,
  );
  assert.match(source, /通知所有新消息/u);
});

test("sidebar preferences clear a transient read error after recovery", () => {
  const source = readFileSync(
    new URL("../src/components/sidebar-preferences.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /head\.current = next;\s+setData\(next\);\s+setError\(undefined\);/u,
  );
});
