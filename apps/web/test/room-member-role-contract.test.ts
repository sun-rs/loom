import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canHumanLeaveRoom,
  canEditRoomMemberRole,
  roomMemberRoleOptions,
} from "../src/room-member-role.ts";

test("Raft Human role editing is structurally ported without granting Room management to Agents", () => {
  const raftHumanPanel = readFileSync(
    "docs/evidence/raft-web-20260831-current/HumanDetailPanel-DvWNsDz9.js",
    "utf8",
  );
  const raftRoleHelp = readFileSync(
    "docs/evidence/raft-web-20260831-current/RolePermissionHelpDialog-Ca2yhS_h.js",
    "utf8",
  );
  assert.match(raftHumanPanel, /await ve\(a\.userId,x\)/);
  assert.match(raftRoleHelp, /member\.roles\.owner/);
  assert.match(raftRoleHelp, /member\.roles\.admin/);
  assert.match(raftRoleHelp, /member\.roles\.member/);

  assert.deepEqual(roomMemberRoleOptions("human"), [
    "owner",
    "admin",
    "member",
  ]);
  assert.deepEqual(roomMemberRoleOptions("agent"), ["member"]);
  assert.equal(
    canEditRoomMemberRole({
      actorRole: "owner",
      caughtUp: true,
      memberWrite: true,
      subjectKind: "human",
    }),
    true,
  );
  assert.equal(
    canEditRoomMemberRole({
      actorRole: "admin",
      caughtUp: true,
      memberWrite: true,
      subjectKind: "human",
    }),
    false,
  );
  assert.equal(
    canEditRoomMemberRole({
      actorRole: "owner",
      caughtUp: true,
      memberWrite: true,
      subjectKind: "agent",
    }),
    false,
  );
});

test("Human self-leave stays server-owned and protects the final owner", () => {
  assert.deepEqual(
    canHumanLeaveRoom({
      archived: false,
      caughtUp: true,
      memberWrite: true,
      ownerCount: 1,
      role: "member",
      roomKind: "channel",
    }),
    { allowed: true },
  );
  assert.deepEqual(
    canHumanLeaveRoom({
      archived: false,
      caughtUp: true,
      memberWrite: true,
      ownerCount: 1,
      role: "owner",
      roomKind: "channel",
    }),
    {
      allowed: false,
      reason: "最后一名所有者需要先把其他 Human 设为所有者",
    },
  );
  assert.equal(
    canHumanLeaveRoom({
      archived: false,
      caughtUp: true,
      memberWrite: true,
      ownerCount: 2,
      role: "owner",
      roomKind: "direct",
    }).allowed,
    false,
  );
});
