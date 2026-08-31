import assert from "node:assert/strict";
import test from "node:test";

import {
  clampRoomSidebarWidth,
  nextRoomSidebarWidth,
  RAFT_ROOM_SIDEBAR_DEFAULT_WIDTH,
  RAFT_ROOM_SIDEBAR_MAX_WIDTH,
  RAFT_ROOM_SIDEBAR_MIN_WIDTH,
} from "../src/room-sidebar-resize.ts";

test("Room sidebar follows the Raft desktop width contract", () => {
  assert.equal(RAFT_ROOM_SIDEBAR_DEFAULT_WIDTH, 240);
  assert.equal(RAFT_ROOM_SIDEBAR_MIN_WIDTH, 180);
  assert.equal(RAFT_ROOM_SIDEBAR_MAX_WIDTH, 400);
  assert.equal(clampRoomSidebarWidth(120), 180);
  assert.equal(clampRoomSidebarWidth(520), 400);
  assert.equal(clampRoomSidebarWidth(268), 268);
});

test("Room sidebar separator supports the complete keyboard contract", () => {
  assert.equal(nextRoomSidebarWidth(240, "ArrowLeft"), 232);
  assert.equal(nextRoomSidebarWidth(240, "ArrowRight"), 248);
  assert.equal(nextRoomSidebarWidth(240, "Home"), 180);
  assert.equal(nextRoomSidebarWidth(240, "End"), 400);
  assert.equal(nextRoomSidebarWidth(240, "Enter"), undefined);
  assert.equal(nextRoomSidebarWidth(180, "ArrowLeft"), 180);
  assert.equal(nextRoomSidebarWidth(400, "ArrowRight"), 400);
});
