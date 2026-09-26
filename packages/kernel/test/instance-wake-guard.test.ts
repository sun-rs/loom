import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  type AuthenticatedActorContext,
  type AuthenticatedHostContext,
  RoomKernel,
} from "../src/index.ts";

/**
 * evo §37 A: an instance's message wakes another instance only by an explicit
 * @mention; Human messages keep their routing. Consecutive instance-to-instance
 * wakes in one Channel since its last Human message are bounded by the runtime
 * setting `wake.instanceChainLimit` (default 10); past it no Activation is
 * created and the Channel gets one system notice. A Human message resets it.
 */

test("an instance's top-level reply without @ wakes no other instance; a Human top-level message still wakes every instance", () => {
  const state = fixture(["alpha", "beta", "gamma"]);
  try {
    const human = state.kernel.postRoomMessage(state.humanActor, {
      body: "Everyone, please look",
      idempotencyKey: "human-top",
      roomId: state.room.roomId,
    });
    assert.equal(human.activationIds.length, 3, "Human keeps room_policy");
    const alpha = state.agents.alpha!;
    const running = beginNextActivation(state.kernel, alpha);
    const reply = state.kernel.postWorkerMessage(running.execution, {
      basedOnRoomSeq: running.delivery.cursorAfter,
      body: "My answer, addressed to nobody in particular",
      idempotencyKey: "alpha-plain-reply",
    });
    assert.ok("event" in reply);
    assert.deepEqual(reply.event.payload.recipientIds, []);
    assert.deepEqual(reply.activationIds, []);
    assert.equal(
      inboxCount(state, reply.event.eventId),
      0,
      "no Inbox item for other instances",
    );
  } finally {
    state.close();
  }
});

test("an instance's explicit @ in a Worker reply wakes exactly the mentioned instance", () => {
  const state = fixture(["alpha", "beta", "gamma"]);
  try {
    state.kernel.postMessage(state.humanActor, {
      body: "@alpha start",
      idempotencyKey: "human-alpha",
      recipients: [
        { participantId: state.agents.alpha!.principalId, reason: "mention" },
      ],
      roomId: state.room.roomId,
    });
    const running = beginNextActivation(state.kernel, state.agents.alpha!);
    const mention = state.kernel.postWorkerMessage(running.execution, {
      basedOnRoomSeq: running.delivery.cursorAfter,
      body: "@beta please verify",
      idempotencyKey: "alpha-mention-reply",
    });
    assert.ok("event" in mention, JSON.stringify(mention));
    assert.deepEqual(mention.event.payload.recipientIds, [
      state.agents.beta!.principalId,
    ]);
    assert.equal(mention.activationIds.length, 1);
  } finally {
    state.close();
  }
});

test("an instance's Thread reply wakes neither Thread followers nor the Thread root author without @", () => {
  const state = fixture(["alpha", "beta"]);
  try {
    const root = state.kernel.postMessage(state.humanActor, {
      body: "Thread root",
      idempotencyKey: "thread-root",
      recipients: [],
      roomId: state.room.roomId,
    });
    const thread = state.kernel.createThread(state.humanActor, {
      basedOnRoomSeq: root.event.roomSeq,
      idempotencyKey: "thread-create",
      recipientIds: [
        state.agents.alpha!.principalId,
        state.agents.beta!.principalId,
      ],
      roomId: state.room.roomId,
      rootMessageId: root.event.aggregateId,
    });
    const threadId = thread.thread.threadId;
    const running = beginNextActivation(state.kernel, state.agents.alpha!);
    const reply = state.kernel.postWorkerMessage(running.execution, {
      basedOnRoomSeq: running.delivery.cursorAfter,
      body: "Following up inside the Thread",
      idempotencyKey: "alpha-thread-reply",
      threadId,
    });
    assert.ok("event" in reply);
    assert.deepEqual(reply.activationIds, []);
    assert.deepEqual(reply.event.payload.recipientIds, []);

    const human = state.kernel.replyThread(state.humanActor, {
      basedOnRoomSeq: reply.event.roomSeq,
      body: "Human follow-up for followers",
      idempotencyKey: "human-thread-reply",
      recipientIds: [],
      roomId: state.room.roomId,
      threadId,
    });
    assert.equal(
      human.activationIds.length,
      2,
      "Human Thread replies still reach every follower",
    );
  } finally {
    state.close();
  }
});

test("a non-mention recipient on an instance-authored message is not activated, whatever facade computed it", () => {
  const state = fixture(["alpha", "beta"]);
  try {
    const posted = state.kernel.postMessage(state.agentActors.alpha!, {
      basedOnRoomSeq: currentSeq(state),
      body: "no explicit mention",
      idempotencyKey: "alpha-room-policy",
      recipients: [
        {
          participantId: state.agents.beta!.principalId,
          reason: "room_policy",
        },
      ],
      roomId: state.room.roomId,
    });
    assert.deepEqual(posted.activationIds, []);
    assert.equal(inboxCount(state, posted.event.eventId), 0);
  } finally {
    state.close();
  }
});

test("new triggers for an instance with pending work merge into its queued Activation", () => {
  const state = fixture(["alpha", "beta"]);
  try {
    const first = mention(state, "alpha", "beta", "m1");
    const second = mention(state, "alpha", "beta", "m2");
    assert.equal(first.activationIds.length, 1);
    assert.deepEqual(second.activationIds, first.activationIds);
    const queued = state.kernel
      .listActivations({ participantId: state.agents.beta!.principalId })
      .filter((activation) => activation.state === "queued");
    assert.equal(queued.length, 1);
    assert.equal(queued[0]!.fromSeq, first.event.roomSeq);
    assert.equal(queued[0]!.toSeq, second.event.roomSeq);
  } finally {
    state.close();
  }
});

test("instance-to-instance wakes stop past the chain limit with one system notice, and a Human message resets the count", () => {
  const state = fixture(["alpha", "beta"]);
  try {
    const admitted: number[] = [];
    for (let hop = 1; hop <= 10; hop += 1) {
      const result =
        hop % 2 === 1
          ? mention(state, "alpha", "beta", `hop-${String(hop)}`)
          : mention(state, "beta", "alpha", `hop-${String(hop)}`);
      admitted.push(result.activationIds.length);
    }
    assert.deepEqual(admitted, Array(10).fill(1));
    assert.equal(systemNotices(state).length, 0);

    const blocked = mention(state, "alpha", "beta", "hop-11");
    assert.deepEqual(blocked.activationIds, []);
    assert.equal(inboxCount(state, blocked.event.eventId), 0);
    const notices = systemNotices(state);
    assert.equal(notices.length, 1, "one notice per trip");
    assert.match(notices[0]!.body, /10/u);
    assert.match(notices[0]!.body, /Human/u);

    const blockedAgain = mention(state, "beta", "alpha", "hop-12");
    assert.deepEqual(blockedAgain.activationIds, []);
    assert.equal(systemNotices(state).length, 1, "no repeated notice");

    const chain = sql(
      state,
      "SELECT streak, admitted FROM instance_wake_chain ORDER BY room_seq, participant_id",
    );
    assert.deepEqual(
      chain.map((row) => [Number(row.streak), Number(row.admitted)]),
      [
        ...Array.from({ length: 10 }, (_, index) => [index + 1, 1]),
        [11, 0],
        [11, 0],
      ],
      "every instance-to-instance wake decision is recorded on the causal chain",
    );

    state.kernel.postMessage(state.humanActor, {
      body: "Carry on",
      idempotencyKey: "human-reset",
      recipients: [],
      roomId: state.room.roomId,
    });
    const resumed = mention(state, "alpha", "beta", "after-reset");
    assert.equal(resumed.activationIds.length, 1);
    assert.equal(
      Number(
        sql(
          state,
          "SELECT streak FROM instance_wake_chain WHERE event_id = ?",
          resumed.event.eventId,
        )[0]!.streak,
      ),
      1,
    );
    for (let hop = 2; hop <= 10; hop += 1)
      mention(state, "alpha", "beta", `second-${String(hop)}`);
    assert.deepEqual(
      mention(state, "alpha", "beta", "second-11").activationIds,
      [],
    );
    assert.equal(systemNotices(state).length, 2, "a new trip notices again");
  } finally {
    state.close();
  }
});

test("the chain count spans every Thread of a Channel, and a Human reply in any Thread resets it", () => {
  const state = fixture(["alpha", "beta"]);
  try {
    const root = state.kernel.postMessage(state.humanActor, {
      body: "root",
      idempotencyKey: "cross-thread-root",
      recipients: [],
      roomId: state.room.roomId,
    });
    const thread = state.kernel.createThread(state.humanActor, {
      basedOnRoomSeq: root.event.roomSeq,
      idempotencyKey: "cross-thread-create",
      recipientIds: [],
      roomId: state.room.roomId,
      rootMessageId: root.event.aggregateId,
    });
    const threadId = thread.thread.threadId;
    for (let hop = 1; hop <= 5; hop += 1)
      threadMention(state, "alpha", "beta", threadId, `t-${String(hop)}`);
    for (let hop = 6; hop <= 10; hop += 1)
      mention(state, "beta", "alpha", `top-${String(hop)}`);
    assert.deepEqual(
      threadMention(state, "alpha", "beta", threadId, "t-11").activationIds,
      [],
      "Thread and top-level wakes share one Channel count",
    );

    state.kernel.replyThread(state.humanActor, {
      basedOnRoomSeq: currentSeq(state),
      body: "Human inside the Thread",
      idempotencyKey: "cross-thread-human",
      recipientIds: [],
      roomId: state.room.roomId,
      threadId,
    });
    assert.equal(
      mention(state, "alpha", "beta", "top-after-thread-human").activationIds
        .length,
      1,
    );
  } finally {
    state.close();
  }
});

test("each Channel keeps its own count: a Human message in one Channel does not reset another", () => {
  const state = fixture(["alpha", "beta"]);
  try {
    const other = state.kernel.createRoom(state.humanActor, {
      name: "Second channel",
      slug: "wake-guard-second",
    });
    for (const agent of Object.values(state.agents))
      state.kernel.addMember(state.humanActor, {
        principalId: agent.principalId,
        roomId: other.roomId,
      });
    for (let hop = 1; hop <= 10; hop += 1)
      mention(state, "alpha", "beta", `first-${String(hop)}`);
    state.kernel.postMessage(state.humanActor, {
      body: "Human in the second channel",
      idempotencyKey: "other-human",
      recipients: [],
      roomId: other.roomId,
    });
    assert.deepEqual(
      mention(state, "alpha", "beta", "first-11").activationIds,
      [],
      "the first Channel stays tripped",
    );
    assert.equal(
      mention(state, "alpha", "beta", "other-1", other.roomId).activationIds
        .length,
      1,
      "the second Channel counts from zero",
    );
  } finally {
    state.close();
  }
});

test("the chain limit is live: a changed wakeGuard setting applies to the next wake without restart", () => {
  const state = fixture(["alpha", "beta"]);
  try {
    state.kernel.runGuards.update({ wakeGuard: { instanceChainLimit: 2 } });
    assert.equal(mention(state, "alpha", "beta", "s1").activationIds.length, 1);
    assert.equal(mention(state, "beta", "alpha", "s2").activationIds.length, 1);
    assert.deepEqual(mention(state, "alpha", "beta", "s3").activationIds, []);
    assert.match(systemNotices(state)[0]!.body, /2/u);
    state.kernel.runGuards.update({ wakeGuard: { instanceChainLimit: 3 } });
    assert.equal(
      mention(state, "beta", "alpha", "s4").activationIds.length,
      1,
      "a raised limit admits the next wake at once",
    );
  } finally {
    state.close();
  }
});

type Agents = Record<string, { principalId: string }>;
type State = ReturnType<typeof fixture>;

function fixture(handles: string[]) {
  const directory = mkdtempSync(join(tmpdir(), "loom-wake-guard-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
  const humanActor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(humanActor, {
    name: "Wake guard",
    slug: "wake-guard",
  });
  const agents: Agents = {};
  const tokens: Record<string, string> = {};
  for (const handle of handles) {
    const provisioned = kernel.provisionPrincipal({ handle, kind: "agent" });
    agents[handle] = provisioned.principal;
    tokens[handle] = provisioned.accessToken;
    kernel.addMember(humanActor, {
      principalId: provisioned.principal.principalId,
      roomId: room.roomId,
    });
  }
  const agentActors: Record<string, AuthenticatedActorContext> = {};
  for (const handle of handles)
    agentActors[handle] = kernel.authenticateAccessToken(tokens[handle]!);
  return {
    agentActors,
    agents,
    close: () => {
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    },
    databasePath,
    humanActor,
    kernel,
    room,
  };
}

function mention(
  state: State,
  from: string,
  to: string,
  key: string,
  roomId = state.room.roomId,
) {
  return state.kernel.postMessage(state.agentActors[from]!, {
    basedOnRoomSeq: currentSeq(state, roomId),
    body: `@${to} ${key}`,
    idempotencyKey: `${from}-${key}`,
    recipients: [
      { participantId: state.agents[to]!.principalId, reason: "mention" },
    ],
    roomId,
  });
}

function threadMention(
  state: State,
  from: string,
  to: string,
  threadId: string,
  key: string,
) {
  return state.kernel.replyThread(state.agentActors[from]!, {
    basedOnRoomSeq: currentSeq(state),
    body: `@${to} ${key}`,
    idempotencyKey: `${from}-${key}`,
    recipientIds: [state.agents[to]!.principalId],
    roomId: state.room.roomId,
    threadId,
  });
}

function currentSeq(state: State, roomId = state.room.roomId): number {
  return Number(
    sql(
      state,
      "SELECT MAX(room_seq) AS seq FROM room_events WHERE room_id = ?",
      roomId,
    )[0]!.seq,
  );
}

function systemNotices(state: State) {
  return sql(
    state,
    `SELECT messages.body FROM messages
      JOIN principals ON principals.principal_id = messages.actor_id
     WHERE principals.kind = 'service' AND messages.room_id = ?
     ORDER BY messages.created_at, messages.rowid`,
    state.room.roomId,
  ).map((row) => ({ body: String(row.body) }));
}

function inboxCount(state: State, eventId: string): number {
  return Number(
    sql(
      state,
      "SELECT COUNT(*) AS count FROM inbox_items WHERE event_id = ?",
      eventId,
    )[0]!.count,
  );
}

function sql(state: State, query: string, ...parameters: string[]) {
  const database = new DatabaseSync(state.databasePath, { readOnly: true });
  try {
    return database.prepare(query).all(...parameters);
  } finally {
    database.close();
  }
}

function beginNextActivation(
  kernel: RoomKernel,
  agent: { principalId: string },
) {
  const host: AuthenticatedHostContext = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: `host-${agent.principalId}`,
      participantIds: [agent.principalId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  const runtime = {
    recoveryDescriptor: {
      driver: "fake-runtime",
      metadata: {},
      recoveryKey: `recovery-${run.runAttemptId}`,
    },
    runAttemptId: run.runAttemptId,
    runtimeRunId: `runtime-${run.runAttemptId}`,
  };
  kernel.prepareRunAttemptRuntime(host, runtime);
  kernel.markRunAttemptRunning(host, runtime);
  const execution = kernel.authorizeWorkerExecution(host, {
    activationId: activation.activationId,
    consumerId: `consumer-${agent.principalId}`,
    hostId: host.hostId,
    participantId: agent.principalId,
    roomId: activation.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  return { delivery: kernel.syncWorker(execution, {}), execution };
}
