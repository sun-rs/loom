import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-agent-thread-follow-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
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
