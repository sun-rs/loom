import assert from "node:assert/strict";
import test from "node:test";
import { ClientApplicationService } from "../../application-service/src/index.ts";
import { HttpRahClient } from "../../client-sdk/src/index.ts";
import { createHumanApplicationPort } from "../src/index.ts";
import {
  claimInstanceRun,
  roleInstanceFixture,
  startInstanceRunFromQueue,
  type RoleInstanceFixture,
} from "./role-instance-fixture.ts";

// S3: the instance private box. Contract §3: only the Human opens it, it
// shares the instance session, queues while busy, never steers channel work
// and is invisible to other instances. Fake Host, durable Kernel state only.

const count = (f: RoleInstanceFixture, sql: string, ...values: string[]) =>
  Number(f.db.prepare(sql).get(...values)!.n);

/** Durable facts a refused private-box open must leave untouched. */
const directRoomFootprint = (f: RoleInstanceFixture) => ({
  directRooms: count(f, "SELECT count(*) n FROM rooms WHERE kind='direct'"),
  pairs: count(f, "SELECT count(*) n FROM direct_room_pairs"),
  controlHead: f.head(f.controlRoomId),
});

const handleOf = (f: RoleInstanceFixture, principalId: string) =>
  String(
    f.db
      .prepare("SELECT handle FROM principals WHERE principal_id=?")
      .get(principalId)!.handle,
  );

function provisionMember(
  f: RoleInstanceFixture,
  handle: string,
  kind: "human" | "agent",
  roomIds: string[],
) {
  const principal = f.kernel.provisionPrincipal({ handle, kind });
  for (const roomId of roomIds)
    f.kernel.addMember(f.actor, {
      roomId,
      principalId: principal.principal.principalId,
    });
  return {
    id: principal.principal.principalId,
    actor: f.kernel.authenticateAccessToken(principal.accessToken),
  };
}

const mention = (f: RoleInstanceFixture, participantId: string) => [
  { participantId, reason: "mention" as const },
];

function startChannelTurn(f: RoleInstanceFixture) {
  f.kernel.postMessage(f.actor, {
    roomId: f.home.roomId,
    body: "channel work",
    idempotencyKey: `channel-${String(Math.random())}`,
    recipients: mention(f, f.instance.instanceId),
  });
  const work = startInstanceRunFromQueue(f);
  assert.equal(work.activation.roomId, f.home.roomId);
  return work;
}

function startPrivateTurn(f: RoleInstanceFixture) {
  const message = f.kernel.postMessage(f.actor, {
    roomId: f.privateBox.roomId,
    body: "private question",
    idempotencyKey: `private-${String(Math.random())}`,
    recipients: mention(f, f.instance.instanceId),
  });
  const work = startInstanceRunFromQueue(f);
  assert.equal(work.activation.roomId, f.privateBox.roomId);
  return { ...work, messageId: message.event.aggregateId };
}

const notice = (
  f: RoleInstanceFixture,
  work: ReturnType<typeof startInstanceRunFromQueue>,
) =>
  f.kernel.readPendingRuntimeNotice(f.host, {
    activationId: work.activation.activationId,
    runAttemptId: work.run.runAttemptId,
  });

test("only a Human in the instance's channel can open its private box; refusals leave no trace", () => {
  const f = roleInstanceFixture();
  try {
    const agent = provisionMember(f, "helper", "agent", [
      f.controlRoomId,
      f.home.roomId,
    ]);
    const outsider = provisionMember(f, "outsider", "human", [f.controlRoomId]);
    const before = directRoomFootprint(f);
    const open = (actor: typeof f.actor, key: string) =>
      f.kernel.openDirectRoom(actor, {
        workspaceId: f.workspace.workspace.workspaceId,
        peerPrincipalId: f.instance.instanceId,
        basedOnControlRoomSeq: f.head(f.controlRoomId),
        idempotencyKey: key,
      });
    assert.throws(
      () => open(agent.actor, "agent-open"),
      /Only a Human can open an instance private box/,
    );
    assert.throws(() => open(outsider.actor, "outsider-open"), /member/i);
    assert.deepEqual(directRoomFootprint(f), before);
  } finally {
    f.close();
  }
});

test("an instance cannot open a Direct Room itself, even to a Human in its channel", () => {
  const f = roleInstanceFixture();
  try {
    const guest = provisionMember(f, "guest", "human", [
      f.controlRoomId,
      f.home.roomId,
    ]);
    const work = startChannelTurn(f);
    const before = directRoomFootprint(f);
    assert.throws(
      () =>
        f.kernel.workerTargetContext.post(work.execution, {
          channel: `dm:@${handleOf(f, guest.id)}`,
          body: "must not open a Direct Room",
          idempotencyKey: "instance-opens-dm",
        }),
      /Only a Human can open an instance private box/,
    );
    assert.deepEqual(directRoomFootprint(f), before);
  } finally {
    f.close();
  }
});

test("a private turn cannot schedule a reminder into its channel", () => {
  const f = roleInstanceFixture();
  try {
    const work = startPrivateTurn(f);
    const reminders = () =>
      count(f, "SELECT count(*) n FROM reminders") +
      count(f, "SELECT count(*) n FROM reminder_events");
    const homeHead = f.head(f.home.roomId);
    assert.throws(
      () =>
        f.kernel.reminders.schedule(work.execution, {
          channel: "#home",
          delaySeconds: 60,
          idempotencyKey: "private-to-channel",
          messageId: work.messageId,
          title: "leak private context into the channel",
        }),
      /active execution target/i,
    );
    assert.equal(reminders(), 0);
    assert.equal(f.head(f.home.roomId), homeHead);
    // The private box itself stays a valid reminder target.
    const own = f.kernel.reminders.schedule(work.execution, {
      delaySeconds: 60,
      idempotencyKey: "private-to-self",
      messageId: work.messageId,
      title: "follow up privately",
    });
    assert.equal(own.reminder.status, "scheduled");
    assert.equal(
      f.db
        .prepare("SELECT target_room_id FROM reminders WHERE reminder_id=?")
        .get(own.reminder.reminderId)!.target_room_id,
      f.privateBox.roomId,
    );
  } finally {
    f.close();
  }
});

test("a channel turn cannot read or write the private box, and never opens a new one", () => {
  const f = roleInstanceFixture();
  try {
    f.kernel.postMessage(f.actor, {
      roomId: f.privateBox.roomId,
      body: "private secret",
      idempotencyKey: "secret",
      recipients: [],
    });
    const work = startChannelTurn(f);
    const before = directRoomFootprint(f);
    const privateBoxHead = f.head(f.privateBox.roomId);
    const scopeRefusal = /outside this instance execution scope/;
    for (const channel of ["dm:@owner", f.privateBox.roomId]) {
      assert.throws(
        () => f.kernel.workerReads.history(work.execution, { channel }),
        scopeRefusal,
        `history ${channel}`,
      );
      assert.throws(
        () => f.kernel.workerTargetContext.read(work.execution, { channel }),
        scopeRefusal,
        `message-read ${channel}`,
      );
      assert.throws(
        () =>
          f.kernel.workerTargetContext.post(work.execution, {
            channel,
            body: "must not reach the private box",
            idempotencyKey: `post-${channel}`,
          }),
        scopeRefusal,
        `messages-post ${channel}`,
      );
    }
    assert.deepEqual(directRoomFootprint(f), before);
    assert.equal(f.head(f.privateBox.roomId), privateBoxHead);
  } finally {
    f.close();
  }
});

test("steer: other members' channel messages never interrupt a channel turn; a Human @ does", () => {
  const f = roleInstanceFixture();
  try {
    const helper = provisionMember(f, "helper", "agent", [f.home.roomId]);
    const second = f.kernel.roles.instantiate(f.actor, {
      roleId: f.role.roleId,
      channelId: f.home.roomId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "second-instance",
    }).instance;
    const work = startChannelTurn(f);
    f.kernel.postMessage(helper.actor, {
      roomId: f.home.roomId,
      body: `@${handleOf(f, f.instance.instanceId)} agent reply`,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "agent-reply",
      recipients: mention(f, f.instance.instanceId),
    });
    // The other instance runs its own lane and replies in the channel.
    f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "second, please answer",
      idempotencyKey: "wake-second",
      recipients: mention(f, second.instanceId),
    });
    const lease = f.kernel.leaseNextActivation(f.host, { leaseMs: 600_000 });
    assert.equal(lease?.participantId, second.instanceId);
    const secondRun = f.kernel.createRunAttempt(f.host, {
      activationId: lease!.activationId,
    });
    const secondRuntime = {
      runAttemptId: secondRun.runAttemptId,
      runtimeRunId: "fake-second",
      recoveryDescriptor: { driver: "fake", recoveryKey: "k", metadata: {} },
    };
    f.kernel.prepareRunAttemptRuntime(f.host, secondRuntime);
    f.kernel.markRunAttemptRunning(f.host, secondRuntime);
    const secondExecution = f.kernel.authorizeWorkerExecution(f.host, {
      activationId: lease!.activationId,
      consumerId: "worker",
      hostId: f.host.hostId,
      participantId: second.instanceId,
      roomId: f.home.roomId,
      runAttemptId: secondRun.runAttemptId,
      toSeq: lease!.toSeq,
    });
    // Read first so the reply is not held behind unseen channel messages.
    f.kernel.workerReads.history(secondExecution, { channel: "#home" });
    f.kernel.workerTargetContext.post(secondExecution, {
      channel: "#home",
      body: `@${handleOf(f, f.instance.instanceId)} instance reply`,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "instance-reply",
    });
    const fromOthers = count(
      f,
      "SELECT count(*) n FROM inbox_items i JOIN room_events e ON e.event_id=i.event_id WHERE i.participant_id=? AND i.state='pending' AND e.actor_id<>?",
      f.instance.instanceId,
      f.owner.principal.principalId,
    );
    assert.equal(fromOthers, 2, "precondition: both replies reached the Inbox");
    assert.equal(notice(f, work), undefined);
    // Positive control: a Human @ in the same channel steers.
    const human = f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "human steer",
      idempotencyKey: "human-steer",
      recipients: mention(f, f.instance.instanceId),
    });
    const steered = notice(f, work);
    assert.ok(steered);
    assert.deepEqual(steered.eventIds, [human.event.eventId]);
  } finally {
    f.close();
  }
});

test("steer: a channel Human @ never interrupts a private turn; a second private message does", () => {
  const f = roleInstanceFixture();
  try {
    const work = startPrivateTurn(f);
    f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "channel request while private turn runs",
      idempotencyKey: "channel-during-private",
      recipients: mention(f, f.instance.instanceId),
    });
    assert.equal(notice(f, work), undefined);
    const followUp = f.kernel.postMessage(f.actor, {
      roomId: f.privateBox.roomId,
      body: "one more private thing",
      idempotencyKey: "private-follow-up",
      recipients: mention(f, f.instance.instanceId),
    });
    const steered = notice(f, work);
    assert.ok(steered);
    assert.deepEqual(steered.eventIds, [followUp.event.eventId]);
    assert.match(steered.text, /dm:@owner/);
  } finally {
    f.close();
  }
});

const post = (f: RoleInstanceFixture, roomId: string, key: string) =>
  f.kernel.postMessage(f.actor, {
    roomId,
    body: `request ${key}`,
    idempotencyKey: key,
    recipients: mention(f, f.instance.instanceId),
  });

test("one session binding covers both boxes; a reset moves both to the new generation", () => {
  const f = roleInstanceFixture();
  try {
    post(f, f.home.roomId, "channel-1");
    const channel = claimInstanceRun(f);
    assert.equal(channel.activation.roomId, f.home.roomId);
    assert.equal(channel.agentContext.instanceSessionRequired, false);
    f.kernel.instanceSessions.record(f.host, {
      runAttemptId: channel.run.runAttemptId,
      runtimeRunId: channel.runtime.runtimeRunId,
    });
    channel.finish(0);
    post(f, f.privateBox.roomId, "private-1");
    const privateTurn = claimInstanceRun(f);
    assert.equal(privateTurn.activation.roomId, f.privateBox.roomId);
    assert.equal(
      privateTurn.agentContext.instanceSessionRequired,
      true,
      "the private turn must resume the channel's bound session",
    );
    assert.equal(privateTurn.agentContext.instanceSessionGeneration, 0);
    privateTurn.finish(0);
    f.kernel.roles.resetInstanceSession(f.actor, {
      instanceId: f.instance.instanceId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "reset",
    });
    post(f, f.privateBox.roomId, "private-2");
    const fresh = claimInstanceRun(f);
    assert.equal(fresh.activation.roomId, f.privateBox.roomId);
    assert.equal(fresh.agentContext.instanceSessionGeneration, 1);
    assert.equal(fresh.agentContext.instanceSessionRequired, false);
    f.kernel.instanceSessions.record(f.host, {
      runAttemptId: fresh.run.runAttemptId,
      runtimeRunId: fresh.runtime.runtimeRunId,
    });
    fresh.finish(0);
    post(f, f.home.roomId, "channel-2");
    const back = claimInstanceRun(f);
    assert.equal(back.activation.roomId, f.home.roomId);
    assert.equal(back.agentContext.instanceSessionGeneration, 1);
    assert.equal(back.agentContext.instanceSessionRequired, true);
    back.finish(0);
  } finally {
    f.close();
  }
});

test("each box keeps its own delivery cursor; interleaved requests resume each box after its own last range", () => {
  const f = roleInstanceFixture();
  try {
    const cursor = (roomId: string) =>
      f.db
        .prepare(
          "SELECT consumer_id, last_seq FROM subscription_cursors WHERE room_id=? AND participant_id=? ORDER BY consumer_id",
        )
        .all(roomId, f.instance.instanceId)
        .map((row) => ({ ...row }));
    post(f, f.home.roomId, "channel-1");
    const channel = startInstanceRunFromQueue(f);
    channel.finish(0);
    const homeCursor = cursor(f.home.roomId);
    assert.deepEqual(
      homeCursor.map((row) => row.last_seq),
      [channel.activation.toSeq],
    );
    post(f, f.privateBox.roomId, "private-1");
    const privateTurn = startInstanceRunFromQueue(f);
    assert.equal(privateTurn.activation.roomId, f.privateBox.roomId);
    // Both boxes receive new requests while the private turn runs.
    const channelRequest = post(f, f.home.roomId, "channel-2");
    const privateRequest = post(f, f.privateBox.roomId, "private-2");
    privateTurn.finish(0);
    assert.deepEqual(cursor(f.home.roomId), homeCursor);
    assert.deepEqual(
      cursor(f.privateBox.roomId).map((row) => row.last_seq),
      [privateTurn.activation.toSeq],
    );
    const next = [startInstanceRunFromQueue(f)];
    next[0]!.finish(0);
    next.push(startInstanceRunFromQueue(f));
    next[1]!.finish(0);
    const byRoom = new Map(next.map((work) => [work.activation.roomId, work]));
    assert.equal(byRoom.size, 2, "one follow-up per box");
    const nextActivation = (roomId: string) =>
      f.kernel
        .listActivations({ roomId })
        .find(
          (activation) =>
            activation.activationId ===
            byRoom.get(roomId)!.activation.activationId,
        )!;
    // An Activation's range starts at its first new request (RAH_FROM_SEQ;
    // earlier events are context). Each box resumes after its own last
    // delivered range, unaffected by work in the other box.
    const homeNext = nextActivation(f.home.roomId);
    assert.ok(homeNext.fromSeq > channel.activation.toSeq);
    assert.equal(homeNext.fromSeq, channelRequest.event.roomSeq);
    const privateNext = nextActivation(f.privateBox.roomId);
    assert.ok(privateNext.fromSeq > privateTurn.activation.toSeq);
    assert.equal(privateNext.fromSeq, privateRequest.event.roomSeq);
    for (const [roomId, activation] of [
      [f.home.roomId, homeNext],
      [f.privateBox.roomId, privateNext],
    ] as const)
      assert.deepEqual(
        cursor(roomId).map((row) => row.last_seq),
        [activation.toSeq],
      );
  } finally {
    f.close();
  }
});

async function humanClient(f: RoleInstanceFixture, accessToken: string) {
  const service = new ClientApplicationService({
    human: createHumanApplicationPort(f.kernel),
    health: () => {
      throw new Error("health not used by this test");
    },
  });
  await service.start();
  return {
    client: new HttpRahClient({
      baseUrl: service.origin,
      accessToken: () => accessToken,
    }),
    close: () => service.close(),
  };
}

test("a Human removed from the channel keeps the private history but cannot add work until re-added", async () => {
  const f = roleInstanceFixture();
  const guestToken = f.kernel.provisionPrincipal({
    handle: "guest",
    kind: "human",
  });
  const guestId = guestToken.principal.principalId;
  for (const roomId of [f.controlRoomId, f.home.roomId])
    f.kernel.addMember(f.actor, { roomId, principalId: guestId });
  const guest = f.kernel.authenticateAccessToken(guestToken.accessToken);
  const http = await humanClient(f, guestToken.accessToken);
  try {
    const box = f.kernel.openDirectRoom(guest, {
      workspaceId: f.workspace.workspace.workspaceId,
      peerPrincipalId: f.instance.instanceId,
      basedOnControlRoomSeq: f.head(f.controlRoomId),
      idempotencyKey: "guest-box",
    });
    const root = f.kernel.postMessage(guest, {
      roomId: box.roomId,
      body: "guest private history",
      idempotencyKey: "guest-root",
      recipients: [],
    });
    // A source the guest can still read after leaving the instance's channel.
    const lounge = f.channel("lounge");
    f.kernel.addMember(f.actor, {
      roomId: lounge.roomId,
      principalId: guestId,
    });
    const source = f.kernel.postMessage(f.actor, {
      roomId: lounge.roomId,
      body: "public note",
      idempotencyKey: "public-source",
      recipients: [],
    });
    f.kernel.removeRoomMember(f.actor, {
      roomId: f.home.roomId,
      principalId: guestId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "remove-guest",
    });
    const activations = () =>
      count(
        f,
        "SELECT count(*) n FROM activations WHERE participant_id=?",
        f.instance.instanceId,
      );
    const before = activations();
    const inactive = /private box.*inactive/i;
    assert.throws(
      () =>
        f.kernel.postMessage(guest, {
          roomId: box.roomId,
          body: "after removal",
          idempotencyKey: "guest-after-removal",
          recipients: mention(f, f.instance.instanceId),
        }),
      inactive,
    );
    assert.throws(
      () =>
        f.kernel.createThread(guest, {
          basedOnRoomSeq: f.head(box.roomId),
          idempotencyKey: "guest-thread",
          recipientIds: [f.instance.instanceId],
          roomId: box.roomId,
          rootMessageId: root.event.aggregateId,
        }),
      inactive,
    );
    const forwarded = f.kernel.forwardMessages(guest, {
      destinationRoomIds: [box.roomId],
      requestId: "guest-forward",
      sourceMessageIds: [source.event.aggregateId],
      sourceRoomId: lounge.roomId,
    });
    assert.equal(forwarded.results[0]!.status, "failed");
    assert.match(JSON.stringify(forwarded.results[0]), inactive);
    assert.equal(activations(), before);
    const history = await http.client.request("message.list", {
      limit: 100,
      roomId: box.roomId,
    });
    assert.deepEqual(
      history.messages.map((message) => message.body),
      ["guest private history"],
    );
    // Re-adding the Human to the channel re-activates the same box.
    f.kernel.addRoomMember(f.actor, {
      roomId: f.home.roomId,
      principalId: guestId,
      role: "member",
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "readd-guest",
    });
    f.kernel.postMessage(guest, {
      roomId: box.roomId,
      body: "back again",
      idempotencyKey: "guest-back",
      recipients: mention(f, f.instance.instanceId),
    });
    assert.equal(activations(), before + 1);
  } finally {
    await http.close();
    f.close();
  }
});

test("re-instantiating the Role opens a new private box; the old one stays inactive", async () => {
  const f = roleInstanceFixture();
  const http = await humanClient(f, f.owner.accessToken);
  try {
    f.kernel.removeRoomMember(f.actor, {
      roomId: f.home.roomId,
      principalId: f.instance.instanceId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "remove-instance",
    });
    const again = f.kernel.roles.instantiate(f.actor, {
      roleId: f.role.roleId,
      channelId: f.home.roomId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "instance-again",
    }).instance;
    const opened = await http.client.request("room.direct.open", {
      workspaceId: f.workspace.workspace.workspaceId,
      peerPrincipalId: again.instanceId,
      basedOnControlRoomSeq: f.head(f.controlRoomId),
      idempotencyKey: "new-box",
    });
    assert.notEqual(opened.room.roomId, f.privateBox.roomId);
    assert.deepEqual(opened.room.instancePrivateBox, {
      instanceId: again.instanceId,
      active: true,
    });
    assert.throws(
      () =>
        f.kernel.postMessage(f.actor, {
          roomId: f.privateBox.roomId,
          body: "old box",
          idempotencyKey: "old-box",
          recipients: [],
        }),
      /private box.*inactive/i,
    );
    const rooms = (
      await http.client.request("room.list", {
        workspaceId: f.workspace.workspace.workspaceId,
      })
    ).rooms;
    const boxOf = (roomId: string) =>
      rooms.find((room) => room.roomId === roomId)?.instancePrivateBox;
    assert.deepEqual(boxOf(f.privateBox.roomId), {
      instanceId: f.instance.instanceId,
      active: false,
    });
    assert.deepEqual(boxOf(opened.room.roomId), {
      instanceId: again.instanceId,
      active: true,
    });
  } finally {
    await http.close();
    f.close();
  }
});

test("only instance private boxes carry the instancePrivateBox projection", async () => {
  const f = roleInstanceFixture();
  const http = await humanClient(f, f.owner.accessToken);
  try {
    const peer = provisionMember(f, "peer", "human", [f.controlRoomId]);
    const plain = await http.client.request("room.direct.open", {
      workspaceId: f.workspace.workspace.workspaceId,
      peerPrincipalId: peer.id,
      basedOnControlRoomSeq: f.head(f.controlRoomId),
      idempotencyKey: "plain-dm",
    });
    assert.equal("instancePrivateBox" in plain.room, false);
    const replay = await http.client.request("room.direct.open", {
      workspaceId: f.workspace.workspace.workspaceId,
      peerPrincipalId: f.instance.instanceId,
      basedOnControlRoomSeq: f.head(f.controlRoomId),
      idempotencyKey: "instance-dm",
    });
    assert.equal(replay.room.roomId, f.privateBox.roomId);
    assert.deepEqual(replay.room.instancePrivateBox, {
      instanceId: f.instance.instanceId,
      active: true,
    });
    const rooms = (
      await http.client.request("room.list", {
        workspaceId: f.workspace.workspace.workspaceId,
      })
    ).rooms;
    for (const room of rooms)
      if (room.roomId !== f.privateBox.roomId)
        assert.equal("instancePrivateBox" in room, false, room.kind);
    // Detaching the Human's channel membership turns the same box inactive.
    f.db
      .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
      .run(f.home.roomId, f.owner.principal.principalId);
    const after = (
      await http.client.request("room.list", {
        workspaceId: f.workspace.workspace.workspaceId,
      })
    ).rooms.find((room) => room.roomId === f.privateBox.roomId);
    assert.deepEqual(after?.instancePrivateBox, {
      instanceId: f.instance.instanceId,
      active: false,
    });
  } finally {
    await http.close();
    f.close();
  }
});
