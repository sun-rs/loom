import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { followAgentThreadParticipants } from "../src/agent-thread-subscriptions.ts";

import { type AuthenticatedHostContext, RoomKernel } from "../src/index.ts";

test("thread creation keeps the first Worker reply in the Thread and persists Agent follow state", () => {
  const state = fixture();
  try {
    const root = state.kernel.postMessage(state.humanActor, {
      body: "Start a focused Thread",
      idempotencyKey: "thread-follow-root",
      recipients: [],
      roomId: state.room.roomId,
    });
    const thread = state.kernel.createThread(state.humanActor, {
      basedOnRoomSeq: root.event.roomSeq,
      idempotencyKey: "thread-follow-create",
      recipientIds: [state.agent.principalId],
      roomId: state.room.roomId,
      rootMessageId: root.event.aggregateId,
    });
    const host = authenticateHost(
      state.kernel,
      "thread-follow-host",
      state.agent.principalId,
    );
    const running = beginNextActivation(
      state.kernel,
      host,
      state.agent.principalId,
    );

    const firstReply = state.kernel.postWorkerMessage(running.execution, {
      basedOnRoomSeq: running.delivery.cursorAfter,
      body: "First Agent reply",
      idempotencyKey: "thread-follow-first-agent-reply",
    });
    assert.ok("event" in firstReply);
    assert.deepEqual(
      state.kernel
        .listMessages(state.humanActor, {
          roomId: state.room.roomId,
          threadId: thread.thread.threadId,
        })
        .messages.map(({ body }) => body),
      ["First Agent reply"],
      "thread.created must route the first Agent response to the created Thread",
    );

    const ordinaryFollowedReply = state.kernel.replyThread(state.humanActor, {
      basedOnRoomSeq: firstReply.event.roomSeq,
      body: "Followers should receive this without another mention",
      idempotencyKey: "thread-follow-ordinary-1",
      recipientIds: [],
      roomId: state.room.roomId,
      threadId: thread.thread.threadId,
    });
    assert.equal(ordinaryFollowedReply.activationIds.length, 1);

    const unfollowed = state.kernel.unfollowWorkerThread(running.execution, {
      basedOnRoomSeq: firstReply.event.roomSeq,
      idempotencyKey: "thread-follow-unfollow",
      threadId: thread.thread.threadId,
    });
    assert.equal(unfollowed.following, false);
    assert.equal(unfollowed.deduplicated, false);
    assert.equal(
      state.kernel.unfollowWorkerThread(running.execution, {
        basedOnRoomSeq: firstReply.event.roomSeq,
        idempotencyKey: "thread-follow-unfollow",
        threadId: thread.thread.threadId,
      }).deduplicated,
      true,
    );

    const mutedReply = state.kernel.replyThread(state.humanActor, {
      basedOnRoomSeq: unfollowed.event.roomSeq,
      body: "Explicitly unfollowed Agent should not receive this",
      idempotencyKey: "thread-follow-muted",
      recipientIds: [],
      roomId: state.room.roomId,
      threadId: thread.thread.threadId,
    });
    assert.deepEqual(mutedReply.activationIds, []);

    const mentionedAgain = state.kernel.replyThread(state.humanActor, {
      basedOnRoomSeq: mutedReply.event.roomSeq,
      body: "@thread-agent please return",
      idempotencyKey: "thread-follow-remention",
      recipientIds: [state.agent.principalId],
      roomId: state.room.roomId,
      threadId: thread.thread.threadId,
    });
    assert.equal(mentionedAgain.activationIds.length, 1);

    const resumedOrdinaryDelivery = state.kernel.replyThread(state.humanActor, {
      basedOnRoomSeq: mentionedAgain.event.roomSeq,
      body: "Ordinary delivery resumes after the exact mention",
      idempotencyKey: "thread-follow-ordinary-2",
      recipientIds: [],
      roomId: state.room.roomId,
      threadId: thread.thread.threadId,
    });
    assert.equal(resumedOrdinaryDelivery.activationIds.length, 1);
  } finally {
    state.close();
  }
});

test("Human thread state exposes the Agent follower roster separately from Human follow", () => {
  const state = fixture();
  try {
    const root = state.kernel.postMessage(state.humanActor, {
      body: "A followed Task thread",
      idempotencyKey: "thread-roster-root",
      recipients: [],
      roomId: state.room.roomId,
    });
    const thread = state.kernel.createThread(state.humanActor, {
      basedOnRoomSeq: root.event.roomSeq,
      idempotencyKey: "thread-roster-create",
      recipientIds: [state.agent.principalId],
      roomId: state.room.roomId,
      rootMessageId: root.event.aggregateId,
    });

    assert.deepEqual(
      state.kernel.getHumanThreadFollowers(state.humanActor, {
        roomId: state.room.roomId,
        threadId: thread.thread.threadId,
      }),
      {
        agentParticipantIds: [state.agent.principalId],
        canManage: true,
        following: true,
      },
    );
    assert.deepEqual(
      state.kernel.followHumanThread(state.humanActor, {
        following: false,
        roomId: state.room.roomId,
        threadId: thread.thread.threadId,
      }),
      { following: false },
    );
    assert.deepEqual(
      state.kernel.getHumanThreadFollowers(state.humanActor, {
        roomId: state.room.roomId,
        threadId: thread.thread.threadId,
      }),
      {
        agentParticipantIds: [state.agent.principalId],
        canManage: true,
        following: false,
      },
      "Human follow state must not mutate the Agent follower roster",
    );
    state.kernel.followHumanThread(state.humanActor, {
      following: true,
      roomId: state.room.roomId,
      threadId: thread.thread.threadId,
    });

    const removed = state.kernel.removeHumanThreadAgentFollower(
      state.humanActor,
      {
        participantId: state.agent.principalId,
        roomId: state.room.roomId,
        threadId: thread.thread.threadId,
      },
    );
    assert.equal(removed.removed, true);
    if (!removed.removed) assert.fail("expected a Raft-style undo token");
    assert.match(removed.undoToken, /^thread_follower_undo_/u);
    assert.deepEqual(
      state.kernel.getHumanThreadFollowers(state.humanActor, {
        roomId: state.room.roomId,
        threadId: thread.thread.threadId,
      }).agentParticipantIds,
      [],
    );
    const regular = state.kernel.provisionPrincipal({
      handle: "thread-regular-human",
      kind: "human",
    });
    const regularActor = state.kernel.authenticateAccessToken(
      regular.accessToken,
    );
    state.kernel.addMember(state.humanActor, {
      principalId: regular.principal.principalId,
      roomId: state.room.roomId,
    });
    assert.throws(
      () =>
        state.kernel.removeHumanThreadAgentFollower(regularActor, {
          participantId: state.agent.principalId,
          roomId: state.room.roomId,
          threadId: thread.thread.threadId,
        }),
      /owner or admin/u,
    );
    const outsider = state.kernel.provisionPrincipal({
      handle: "thread-outsider-human",
      kind: "human",
    });
    const outsiderActor = state.kernel.authenticateAccessToken(
      outsider.accessToken,
    );
    assert.throws(
      () =>
        state.kernel.getHumanThreadFollowers(outsiderActor, {
          roomId: state.room.roomId,
          threadId: thread.thread.threadId,
        }),
      /member/u,
    );
    assert.deepEqual(
      state.kernel.restoreHumanThreadAgentFollower(state.humanActor, {
        participantId: state.agent.principalId,
        roomId: state.room.roomId,
        threadId: thread.thread.threadId,
        undoToken: removed.undoToken,
      }),
      { restored: true },
    );
    assert.deepEqual(
      state.kernel.getHumanThreadFollowers(state.humanActor, {
        roomId: state.room.roomId,
        threadId: thread.thread.threadId,
      }).agentParticipantIds,
      [state.agent.principalId],
    );
    const removedAgain = state.kernel.removeHumanThreadAgentFollower(
      state.humanActor,
      {
        participantId: state.agent.principalId,
        roomId: state.room.roomId,
        threadId: thread.thread.threadId,
      },
    );
    assert.equal(removedAgain.removed, true);
    if (!removedAgain.removed) assert.fail("expected a second undo token");
    assert.throws(
      () =>
        state.kernel.restoreHumanThreadAgentFollower(regularActor, {
          participantId: state.agent.principalId,
          roomId: state.room.roomId,
          threadId: thread.thread.threadId,
          undoToken: removedAgain.undoToken,
        }),
      /owner or admin/u,
    );
    const otherRoot = state.kernel.postMessage(state.humanActor, {
      body: "Another root",
      idempotencyKey: "thread-roster-other-root",
      recipients: [],
      roomId: state.room.roomId,
    });
    const otherThread = state.kernel.createThread(state.humanActor, {
      basedOnRoomSeq: otherRoot.event.roomSeq,
      idempotencyKey: "thread-roster-other-create",
      recipientIds: [],
      roomId: state.room.roomId,
      rootMessageId: otherRoot.event.aggregateId,
    });
    assert.deepEqual(
      state.kernel.restoreHumanThreadAgentFollower(state.humanActor, {
        participantId: state.agent.principalId,
        roomId: state.room.roomId,
        threadId: otherThread.thread.threadId,
        undoToken: removedAgain.undoToken,
      }),
      { restored: false },
      "an undo token cannot be replayed against another Thread",
    );
    const legacy = new DatabaseSync(state.databasePath);
    legacy
      .prepare(
        "UPDATE agent_thread_follower_undo SET expires_at = ? WHERE undo_token = ?",
      )
      .run("2000-01-01T00:00:00.000Z", removedAgain.undoToken);
    assert.deepEqual(
      state.kernel.restoreHumanThreadAgentFollower(state.humanActor, {
        participantId: state.agent.principalId,
        roomId: state.room.roomId,
        threadId: thread.thread.threadId,
        undoToken: removedAgain.undoToken,
      }),
      { restored: false },
      "an expired undo token cannot restore an Agent follower",
    );
    legacy
      .prepare("DELETE FROM memberships WHERE principal_id = ? AND room_id = ?")
      .run(state.agent.principalId, state.room.roomId);
    legacy
      .prepare(
        `UPDATE agent_thread_follows
         SET following = 1, source = 'participation'
         WHERE participant_id = ? AND thread_id = ?`,
      )
      .run(state.agent.principalId, thread.thread.threadId);
    legacy.close();
    assert.deepEqual(
      state.kernel.getHumanThreadFollowers(state.humanActor, {
        roomId: state.room.roomId,
        threadId: thread.thread.threadId,
      }).agentParticipantIds,
      [],
    );
  } finally {
    state.close();
  }
});

test("member removal retains history and follows but fences Thread delivery until rejoin", () => {
  const state = fixture();
  try {
    const root = state.kernel.postMessage(state.humanActor, {
      body: "Retained history",
      idempotencyKey: "removal-root",
      recipients: [],
      roomId: state.room.roomId,
    });
    const thread = state.kernel.createThread(state.humanActor, {
      basedOnRoomSeq: root.event.roomSeq,
      idempotencyKey: "removal-thread",
      recipientIds: [],
      roomId: state.room.roomId,
      rootMessageId: root.event.aggregateId,
    });
    // Arrange a durable, idle follower through its existing owner, without starting a CLI.
    const db = new DatabaseSync(state.databasePath);
    try {
      followAgentThreadParticipants(db, {
        participantIds: [state.agent.principalId],
        source: "participation",
        threadId: thread.thread.threadId,
        updatedAt: "2026-09-14T00:00:00.000Z",
      });
    } finally {
      db.close();
    }
    const input = {
      basedOnRoomSeq: thread.event.roomSeq,
      idempotencyKey: "removal-member",
      principalId: state.agent.principalId,
      roomId: state.room.roomId,
    };
    const removed = state.kernel.removeRoomMember(state.humanActor, input);
    assert.equal(
      state.kernel.removeRoomMember(state.humanActor, input).deduplicated,
      true,
    );
    assert.throws(
      () =>
        state.kernel.listMessages(state.agentActor, {
          roomId: state.room.roomId,
        }),
      /member|access/i,
    );
    const reply = state.kernel.replyThread(state.humanActor, {
      basedOnRoomSeq: removed.event.roomSeq,
      body: "No delivery after removal",
      idempotencyKey: "removal-reply",
      recipientIds: [],
      roomId: state.room.roomId,
      threadId: thread.thread.threadId,
    });
    assert.equal(reply.activationIds.length, 0);
    const rejoined = state.kernel.addRoomMember(state.humanActor, {
      basedOnRoomSeq: reply.event.roomSeq,
      idempotencyKey: "removal-rejoin",
      principalId: state.agent.principalId,
      role: "member",
      roomId: state.room.roomId,
    });
    assert.ok(
      state.kernel
        .listMessages(state.agentActor, { roomId: state.room.roomId })
        .messages.some((m) => m.body === "Retained history"),
    );
    const resumed = state.kernel.replyThread(state.humanActor, {
      basedOnRoomSeq: rejoined.event.roomSeq,
      body: "Preserved follow resumes",
      idempotencyKey: "removal-resumed-reply",
      recipientIds: [],
      roomId: state.room.roomId,
      threadId: thread.thread.threadId,
    });
    assert.equal(resumed.activationIds.length, 1);
  } finally {
    state.close();
  }
});

test("channel joins never subscribe existing threads; only existing members can be added as followers", () => {
  const state = fixture();
  const db = new DatabaseSync(state.databasePath);
  try {
    const outsider = state.kernel.provisionPrincipal({
      handle: "new-channel-agent",
      kind: "agent",
    }).principal;
    const root = state.kernel.postMessage(state.humanActor, {
      roomId: state.room.roomId,
      body: "Existing task discussion",
      recipients: [],
      idempotencyKey: "boundary-root",
    });
    const create = {
      roomId: state.room.roomId,
      rootMessageId: root.event.aggregateId,
      basedOnRoomSeq: root.event.roomSeq,
      idempotencyKey: "boundary-thread",
      recipientIds: [outsider.principalId],
    };
    assert.throws(
      () => state.kernel.createThread(state.humanActor, create),
      /member/i,
    );
    const thread = state.kernel.createThread(state.humanActor, {
      ...create,
      recipientIds: [],
    });
    const reply = {
      roomId: state.room.roomId,
      threadId: thread.thread.threadId,
      basedOnRoomSeq: thread.event.roomSeq,
      idempotencyKey: "boundary-reply",
      recipientIds: [outsider.principalId],
      body: "explicit outside recipient",
    };
    assert.throws(
      () => state.kernel.replyThread(state.humanActor, reply),
      /member/i,
    );
    const followers = () =>
      db
        .prepare(
          "SELECT participant_id FROM agent_thread_follows WHERE thread_id = ? AND following = 1",
        )
        .all(thread.thread.threadId)
        .map((row) => row.participant_id);
    followAgentThreadParticipants(db, {
      threadId: thread.thread.threadId,
      participantIds: [outsider.principalId],
      source: "mention",
      updatedAt: "2026-09-20T00:00:00.000Z",
    });
    assert.deepEqual(
      followers(),
      [],
      "even the internal writer fences nonmembers",
    );
    const joined = state.kernel.addRoomMember(state.humanActor, {
      roomId: state.room.roomId,
      principalId: outsider.principalId,
      role: "member",
      basedOnRoomSeq: thread.event.roomSeq,
      idempotencyKey: "boundary-join",
    });
    assert.deepEqual(
      followers(),
      [],
      "joining the channel must not subscribe an existing discussion",
    );
    state.kernel.replyThread(state.humanActor, {
      ...reply,
      basedOnRoomSeq: joined.event.roomSeq,
    });
    assert.deepEqual(
      followers(),
      [outsider.principalId],
      "explicit thread addition is allowed only after channel join",
    );
  } finally {
    db.close();
    state.close();
  }
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-agent-thread-follow-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const human = kernel.provisionPrincipal({
    handle: "thread-human",
    kind: "human",
  });
  const agent = kernel.provisionPrincipal({
    handle: "thread-agent",
    kind: "agent",
  });
  const humanActor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(humanActor, {
    name: "Agent Thread follow",
    slug: "agent-thread-follow",
  });
  kernel.addMember(humanActor, {
    principalId: agent.principal.principalId,
    roomId: room.roomId,
  });
  return {
    agent: agent.principal,
    agentActor: kernel.authenticateAccessToken(agent.accessToken),
    databasePath,
    close: () => {
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    },
    humanActor,
    kernel,
    room,
  };
}

function authenticateHost(
  kernel: RoomKernel,
  hostId: string,
  participantId: string,
): AuthenticatedHostContext {
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId,
      participantIds: [participantId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  return host;
}

function beginNextActivation(
  kernel: RoomKernel,
  host: AuthenticatedHostContext,
  participantId: string,
) {
  const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  const runtime = {
    recoveryDescriptor: {
      driver: "fake-runtime",
      metadata: {},
      recoveryKey: "thread-follow-recovery",
    },
    runAttemptId: run.runAttemptId,
    runtimeRunId: "thread-follow-runtime",
  };
  kernel.prepareRunAttemptRuntime(host, runtime);
  kernel.markRunAttemptRunning(host, runtime);
  const execution = kernel.authorizeWorkerExecution(host, {
    activationId: activation.activationId,
    consumerId: "thread-follow-consumer",
    hostId: host.hostId,
    participantId,
    roomId: activation.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  return {
    delivery: kernel.syncWorker(execution, {}),
    execution,
  };
}
