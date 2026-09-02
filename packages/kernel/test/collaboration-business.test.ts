import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RoomKernel } from "../src/index.ts";

test("Room roles are canonical, causal, and preserve at least one Human owner", () => {
  const fixture = collaborationFixture();
  try {
    assert.deepEqual(
      fixture.kernel
        .listWorkspaces(fixture.ownerActor)
        .map((workspace) => workspace.workspaceId),
      [fixture.room.workspaceId],
    );
    assert.deepEqual(
      fixture.kernel
        .listRooms(fixture.ownerActor, {
          workspaceId: fixture.room.workspaceId,
        })
        .map((room) => room.roomId),
      [fixture.room.roomId],
    );
    assert.deepEqual(fixture.kernel.listRooms(fixture.outsiderActor), []);
    assert.throws(
      () =>
        fixture.kernel.listRoomMemberships(fixture.outsiderActor, {
          roomId: fixture.room.roomId,
        }),
      /not a member/,
    );

    assert.throws(
      () =>
        fixture.kernel.addMember(fixture.memberActor, {
          principalId: fixture.outsider.principal.principalId,
          roomId: fixture.room.roomId,
        }),
      /owner or admin/,
    );
    const adminRole = fixture.kernel.setRoomMemberRole(fixture.ownerActor, {
      basedOnRoomSeq: latestRoomSeq(fixture),
      idempotencyKey: "role-admin",
      principalId: fixture.admin.principal.principalId,
      role: "admin",
      roomId: fixture.room.roomId,
    });
    assert.equal(adminRole.membership.role, "admin");
    assert.equal(
      fixture.kernel.setRoomMemberRole(fixture.ownerActor, {
        basedOnRoomSeq: latestRoomSeq(fixture),
        idempotencyKey: "role-admin",
        principalId: fixture.admin.principal.principalId,
        role: "admin",
        roomId: fixture.room.roomId,
      }).deduplicated,
      true,
    );
    assert.throws(
      () =>
        fixture.kernel.setRoomMemberRole(fixture.ownerActor, {
          basedOnRoomSeq: latestRoomSeq(fixture),
          idempotencyKey: "role-agent-admin",
          principalId: fixture.agent.principal.principalId,
          role: "admin",
          roomId: fixture.room.roomId,
        }),
      /Human principal/,
    );

    const added = fixture.kernel.addRoomMember(fixture.adminActor, {
      basedOnRoomSeq: latestRoomSeq(fixture),
      idempotencyKey: "membership-outsider-add",
      principalId: fixture.outsider.principal.principalId,
      role: "member",
      roomId: fixture.room.roomId,
    });
    assert.equal(added.membership.role, "member");
    const removed = fixture.kernel.removeRoomMember(fixture.adminActor, {
      basedOnRoomSeq: added.event.roomSeq,
      idempotencyKey: "membership-outsider-remove",
      principalId: fixture.outsider.principal.principalId,
      roomId: fixture.room.roomId,
    });
    assert.equal(
      removed.removedPrincipalId,
      fixture.outsider.principal.principalId,
    );
    assert.equal(
      fixture.kernel.removeRoomMember(fixture.adminActor, {
        basedOnRoomSeq: removed.event.roomSeq,
        idempotencyKey: "membership-outsider-remove",
        principalId: fixture.outsider.principal.principalId,
        roomId: fixture.room.roomId,
      }).deduplicated,
      true,
    );
    assert.throws(
      () =>
        fixture.kernel.removeRoomMember(fixture.adminActor, {
          basedOnRoomSeq: removed.event.roomSeq,
          idempotencyKey: "membership-owner-remove-by-admin",
          principalId: fixture.owner.principal.principalId,
          roomId: fixture.room.roomId,
        }),
      /only a Room owner/,
    );
    assert.throws(
      () =>
        fixture.kernel.setRoomMemberRole(fixture.ownerActor, {
          basedOnRoomSeq: added.event.roomSeq,
          idempotencyKey: "stale-role-change",
          principalId: fixture.admin.principal.principalId,
          role: "member",
          roomId: fixture.room.roomId,
        }),
      /stale/i,
    );
    assert.throws(
      () =>
        fixture.kernel.setRoomMemberRole(fixture.ownerActor, {
          basedOnRoomSeq: latestRoomSeq(fixture),
          idempotencyKey: "last-owner-demotion",
          principalId: fixture.owner.principal.principalId,
          role: "member",
          roomId: fixture.room.roomId,
        }),
      /last owner/,
    );
    const secondOwner = fixture.kernel.setRoomMemberRole(fixture.ownerActor, {
      basedOnRoomSeq: latestRoomSeq(fixture),
      idempotencyKey: "role-second-owner",
      principalId: fixture.admin.principal.principalId,
      role: "owner",
      roomId: fixture.room.roomId,
    });
    assert.equal(secondOwner.membership.role, "owner");
    const demoted = fixture.kernel.setRoomMemberRole(fixture.ownerActor, {
      basedOnRoomSeq: secondOwner.event.roomSeq,
      idempotencyKey: "role-first-owner-demoted",
      principalId: fixture.owner.principal.principalId,
      role: "member",
      roomId: fixture.room.roomId,
    });
    assert.equal(demoted.membership.role, "member");
    assert.throws(
      () =>
        fixture.kernel.removeRoomMember(fixture.adminActor, {
          basedOnRoomSeq: demoted.event.roomSeq,
          idempotencyKey: "last-owner-removal",
          principalId: fixture.admin.principal.principalId,
          roomId: fixture.room.roomId,
        }),
      /last owner/,
    );
  } finally {
    fixture.close();
  }
});

test("a Human can leave only their own regular Channel membership", () => {
  const fixture = collaborationFixture();
  try {
    const before = latestRoomSeq(fixture);
    const left = fixture.kernel.leaveRoom(fixture.memberActor, {
      basedOnRoomSeq: before,
      idempotencyKey: "member-self-leave",
      roomId: fixture.room.roomId,
    });
    assert.equal(left.removedPrincipalId, fixture.member.principal.principalId);
    assert.equal(left.event.type, "membership.removed");
    assert.equal(left.event.actorId, fixture.member.principal.principalId);
    assert.equal(
      left.event.payload.participantId,
      fixture.member.principal.principalId,
    );
    assert.equal(left.event.payload.previousRole, "member");
    assert.deepEqual(fixture.kernel.listRooms(fixture.memberActor), []);
    assert.equal(
      fixture.kernel.leaveRoom(fixture.memberActor, {
        basedOnRoomSeq: left.event.roomSeq,
        idempotencyKey: "member-self-leave",
        roomId: fixture.room.roomId,
      }).deduplicated,
      true,
      "retry remains idempotent after the membership row is gone",
    );
    assert.throws(
      () =>
        fixture.kernel.leaveRoom(fixture.ownerActor, {
          basedOnRoomSeq: left.event.roomSeq,
          idempotencyKey: "last-owner-self-leave",
          roomId: fixture.room.roomId,
        }),
      /last owner/i,
    );
    assert.throws(
      () =>
        fixture.kernel.leaveRoom(fixture.agentActor, {
          basedOnRoomSeq: left.event.roomSeq,
          idempotencyKey: "agent-self-leave-through-human-port",
          roomId: fixture.room.roomId,
        }),
      /only Human principals/i,
    );
  } finally {
    fixture.close();
  }
});

test("Thread replies remain Room-owned and derive durable attention without provider sessions", () => {
  const fixture = collaborationFixture();
  try {
    const root = fixture.kernel.postMessage(fixture.ownerActor, {
      body: "Review the daemon boundary",
      idempotencyKey: "thread-root-message",
      recipients: [],
      roomId: fixture.room.roomId,
    });
    assert.deepEqual(
      fixture.kernel
        .listMessages(fixture.ownerActor, { roomId: fixture.room.roomId })
        .messages.map((message) => message.messageId),
      [root.event.aggregateId],
    );
    const created = fixture.kernel.createThread(fixture.ownerActor, {
      basedOnRoomSeq: root.event.roomSeq,
      idempotencyKey: "thread-create",
      recipientIds: [fixture.agent.principal.principalId],
      roomId: fixture.room.roomId,
      rootMessageId: root.event.aggregateId,
    });
    assert.equal(created.thread.rootMessageId, root.event.aggregateId);
    assert.equal(created.activationIds.length, 1);
    assert.throws(
      () =>
        fixture.kernel.removeRoomMember(fixture.ownerActor, {
          basedOnRoomSeq: created.event.roomSeq,
          idempotencyKey: "membership-busy-agent-remove",
          principalId: fixture.agent.principal.principalId,
          roomId: fixture.room.roomId,
        }),
      /active collaboration work/,
    );

    const replied = fixture.kernel.replyThread(fixture.memberActor, {
      basedOnRoomSeq: created.event.roomSeq,
      body: "The Room ledger remains authoritative.",
      idempotencyKey: "thread-reply",
      recipientIds: [fixture.agent.principal.principalId],
      roomId: fixture.room.roomId,
      threadId: created.thread.threadId,
    });
    assert.equal(replied.event.payload.threadId, created.thread.threadId);
    assert.equal(replied.activationIds.length, 1);
    const firstMessagePage = fixture.kernel.listMessages(fixture.ownerActor, {
      limit: 1,
      roomId: fixture.room.roomId,
    });
    assert.equal(
      firstMessagePage.messages[0]?.messageId,
      replied.event.aggregateId,
    );
    assert.equal(firstMessagePage.hasMoreBefore, true);
    assert.equal(firstMessagePage.hasMoreAfter, false);
    const secondMessagePage = fixture.kernel.listMessages(fixture.ownerActor, {
      beforeSeq: firstMessagePage.cursorBefore,
      limit: 1,
      roomId: fixture.room.roomId,
    });
    assert.equal(
      secondMessagePage.messages[0]?.messageId,
      root.event.aggregateId,
    );
    assert.equal(secondMessagePage.hasMoreBefore, false);
    assert.equal(secondMessagePage.hasMoreAfter, true);
    assert.throws(
      () =>
        fixture.kernel.postMessage(fixture.memberActor, {
          basedOnRoomSeq: replied.event.roomSeq,
          body: "The Room ledger remains authoritative.",
          idempotencyKey: "thread-reply",
          recipients: [
            {
              participantId: fixture.agent.principal.principalId,
              reason: "thread_subscription",
            },
          ],
          roomId: fixture.room.roomId,
        }),
      /idempotency key/,
    );
    assert.deepEqual(
      fixture.kernel
        .listMessages(fixture.ownerActor, {
          roomId: fixture.room.roomId,
          threadId: created.thread.threadId,
        })
        .messages.map((message) => message.messageId),
      [replied.event.aggregateId],
    );
    assert.equal(
      fixture.kernel.listThreads(fixture.ownerActor, {
        roomId: fixture.room.roomId,
      })[0]?.replyCount,
      1,
    );
    assert.equal(
      fixture.kernel.replyThread(fixture.memberActor, {
        basedOnRoomSeq: replied.event.roomSeq,
        body: "The Room ledger remains authoritative.",
        idempotencyKey: "thread-reply",
        recipientIds: [fixture.agent.principal.principalId],
        roomId: fixture.room.roomId,
        threadId: created.thread.threadId,
      }).deduplicated,
      true,
    );
    assert.equal(
      fixture.kernel.listThreads(fixture.ownerActor, {
        roomId: fixture.room.roomId,
      })[0]?.replyCount,
      1,
    );
    assert.ok(
      fixture.kernel
        .listInbox(fixture.agentActor, {
          roomId: fixture.room.roomId,
        })
        .some((item) => item.reason === "thread_subscription"),
    );

    const otherRoom = fixture.kernel.createRoom(fixture.ownerActor, {
      name: "Other collaboration Room",
      slug: "other-collaboration-room",
    });
    const foreignRoot = fixture.kernel.postMessage(fixture.ownerActor, {
      body: "This root belongs elsewhere",
      idempotencyKey: "foreign-thread-root",
      recipients: [],
      roomId: otherRoom.roomId,
    });
    assert.throws(
      () =>
        fixture.kernel.createThread(fixture.ownerActor, {
          basedOnRoomSeq: latestRoomSeq(fixture),
          idempotencyKey: "cross-room-thread-create",
          recipientIds: [],
          roomId: fixture.room.roomId,
          rootMessageId: foreignRoot.event.aggregateId,
        }),
      /not found in Room/,
    );
    const foreignThread = fixture.kernel.createThread(fixture.ownerActor, {
      basedOnRoomSeq: foreignRoot.event.roomSeq,
      idempotencyKey: "foreign-thread-create",
      recipientIds: [],
      roomId: otherRoom.roomId,
      rootMessageId: foreignRoot.event.aggregateId,
    });
    assert.throws(
      () =>
        fixture.kernel.replyThread(fixture.ownerActor, {
          basedOnRoomSeq: latestRoomSeq(fixture),
          body: "Do not cross the Room boundary",
          idempotencyKey: "cross-room-thread-reply",
          recipientIds: [],
          roomId: fixture.room.roomId,
          threadId: foreignThread.thread.threadId,
        }),
      /not found in Room/,
    );
    assert.equal(
      JSON.stringify(
        fixture.kernel.sync(fixture.ownerActor, {
          consumerId: "thread-reconnect",
          roomId: fixture.room.roomId,
        }),
      ).includes("providerSessionId"),
      false,
    );
  } finally {
    fixture.close();
  }
});

function collaborationFixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-collaboration-p2-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  kernel.initialize();
  const provisionHuman = (handle: string) =>
    kernel.provisionPrincipal({ handle, kind: "human" });
  const owner = provisionHuman("p2-owner");
  const admin = provisionHuman("p2-admin");
  const member = provisionHuman("p2-member");
  const outsider = provisionHuman("p2-outsider");
  const agent = kernel.provisionPrincipal({
    handle: "p2-agent",
    kind: "agent",
  });
  const ownerActor = kernel.authenticateAccessToken(owner.accessToken);
  const adminActor = kernel.authenticateAccessToken(admin.accessToken);
  const memberActor = kernel.authenticateAccessToken(member.accessToken);
  const outsiderActor = kernel.authenticateAccessToken(outsider.accessToken);
  const agentActor = kernel.authenticateAccessToken(agent.accessToken);
  const room = kernel.createRoom(ownerActor, {
    name: "Collaboration P2",
    slug: "collaboration-p2",
  });
  for (const principalId of [
    admin.principal.principalId,
    member.principal.principalId,
    agent.principal.principalId,
  ]) {
    kernel.addMember(ownerActor, { principalId, roomId: room.roomId });
  }
  return {
    admin,
    adminActor,
    agent,
    agentActor,
    close: () => {
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    },
    kernel,
    member,
    memberActor,
    outsider,
    outsiderActor,
    owner,
    ownerActor,
    room,
  };
}

function latestRoomSeq(
  fixture: ReturnType<typeof collaborationFixture>,
): number {
  return fixture.kernel.sync(fixture.ownerActor, {
    consumerId: "p2-latest",
    roomId: fixture.room.roomId,
  }).latestRoomSeq;
}
