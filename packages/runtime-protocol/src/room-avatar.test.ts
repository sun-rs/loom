import assert from "node:assert/strict";
import test from "node:test";

import {
  isRoomAgentAvatarKey,
  ROOM_AGENT_AVATAR_KEYS,
} from "./room-avatar";

test("Room Agent avatar identity is restricted to the extracted official library", () => {
  assert.equal(ROOM_AGENT_AVATAR_KEYS.length, 16);
  assert.equal(new Set(ROOM_AGENT_AVATAR_KEYS).size, ROOM_AGENT_AVATAR_KEYS.length);
  assert.equal(isRoomAgentAvatarKey("robot"), true);
  assert.equal(isRoomAgentAvatarKey("finch"), false);
  assert.equal(isRoomAgentAvatarKey("generated-pixels"), false);
});
