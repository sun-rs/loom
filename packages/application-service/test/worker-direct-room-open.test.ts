import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { RoomKernel } from "@rah-os/kernel";
import * as P from "@rah-os/protocol";
import { WorkerApplicationService } from "../src/index.ts";

/**
 * Raft's `resolveChannel` ("Resolve a writable channel, DM, or thread target
 * for the bound agent credential") and the standing prompt's
 * `**Start a NEW DM**: raft message send --target dm:@person-name`. The Agent
 * addresses a peer it already shares a Room with and the Direct Room comes
 * into existence on that first send or resolve.
 */
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "rah-agent-dm-"));
  const now = new Date("2026-09-09T12:00:00.000Z");
  const databasePath = join(dir, "room.db");
  const kernel = new RoomKernel({ databasePath, now: () => now });
  const service = new WorkerApplicationService({ kernel });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
  const agent = kernel.provisionPrincipal({ handle: "reader", kind: "agent" });
  const outsider = kernel.provisionPrincipal({
    handle: "foreign",
    kind: "human",
  });
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "Shared", slug: "shared" });
  kernel.addMember(actor, {
    roomId: room.roomId,
    principalId: agent.principal.principalId,
  });
  const workspace = kernel.createWorkspace(actor, {
    name: "Managed",
    slug: "managed",
    idempotencyKey: "workspace",
  });
  for (const principalId of [
    agent.principal.principalId,
    outsider.principal.principalId,
  ])
    kernel.addMember(actor, {
      roomId: workspace.controlRoom.roomId,
      principalId,
    });
  kernel.postMessage(actor, {
    roomId: room.roomId,
    body: "Please reach out",
    recipients: [
      { participantId: agent.principal.principalId, reason: "mention" },
    ],
    idempotencyKey: "wake",
  });
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "host",
      participantIds: [agent.principal.principalId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 60000 })!;
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  const runtime = {
    runAttemptId: run.runAttemptId,
    runtimeRunId: "runtime",
    recoveryDescriptor: {
      driver: "fake",
      metadata: {},
      recoveryKey: "runtime",
    },
  };
  kernel.prepareRunAttemptRuntime(host, runtime);
  kernel.markRunAttemptRunning(host, runtime);
  await service.start();
  const credential = service.issueActivationCredential(host, {
    activationId: activation.activationId,
    consumerId: "reader",
    hostId: host.hostId,
    participantId: agent.principal.principalId,
    roomId: room.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  const call = (path: string, body: unknown = {}) =>
    fetch(`${service.origin}/v1/worker/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const database = new DatabaseSync(databasePath);
  return {
    actor,
    agent,
    call,
    database,
    human,
    kernel,
    outsider,
    room,
    workspace,
    async close() {
      database.close();
      await service.close();
      kernel.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("an Agent sending to dm:@peer creates the Direct Room and reuses it", async () => {
  const f = await fixture();
  try {
    assert.equal(
      f.database.prepare("SELECT count(*) AS n FROM direct_room_pairs").get()!
        .n,
      0,
    );
    const first = await f.call("messages/post", {
      channel: "dm:@human",
      body: "Opening a new DM",
    });
    assert.equal(first.status, 200, await first.clone().text());
    const posted = P.WorkerMessagePostResponseSchema.parse(await first.json());
    assert.ok("event" in posted, JSON.stringify(posted));
    const resolved = P.WorkerRoomResolveResponseSchema.parse(
      await (await f.call("rooms/resolve", { channel: "dm:@human" })).json(),
    );
    assert.equal(resolved.room.kind, "direct");
    assert.equal(resolved.channel, "dm:@human");
    const roomId = resolved.room.roomId;
    // The message landed in the Room the Agent's own send created.
    assert.equal(
      f.database
        .prepare("SELECT room_id FROM messages WHERE message_id=?")
        .get(posted.event.aggregateId)!.room_id,
      roomId,
    );
    const second = await f.call("messages/post", {
      channel: "dm:@human",
      body: "Second message in the same DM",
    });
    assert.equal(second.status, 200, await second.clone().text());
    assert.equal(
      f.database
        .prepare("SELECT count(*) AS n FROM messages WHERE room_id=?")
        .get(roomId)!.n,
      2,
    );
    // One Room, one pair row, and no second creation path.
    assert.equal(
      f.database.prepare("SELECT count(*) AS n FROM direct_room_pairs").get()!
        .n,
      1,
    );
    assert.equal(
      f.database
        .prepare("SELECT count(*) AS n FROM rooms WHERE kind='direct'")
        .get()!.n,
      1,
    );
  } finally {
    await f.close();
  }
});

test("a DM an Agent created behaves like any other DM afterwards", async () => {
  const f = await fixture();
  try {
    await f.call("messages/post", { channel: "dm:@human", body: "First" });
    const roomId = P.WorkerRoomResolveResponseSchema.parse(
      await (await f.call("rooms/resolve", { channel: "dm:@human" })).json(),
    ).room.roomId;
    // Reads work through the ordinary joined-Room surface.
    assert.match(
      await (await f.call("messages/history", { channel: "dm:@human" })).text(),
      /First/u,
    );
    const context = P.WorkerRoomContextResponseSchema.parse(
      await (
        await f.call("rooms/read", { channel: "dm:@human", limit: 10 })
      ).json(),
    );
    assert.equal(context.complete, true);
    // The Human replies; the Agent's next send is held on freshness, exactly
    // as it would be in a Human-opened DM.
    f.kernel.postMessage(f.actor, {
      roomId,
      body: "Human reply",
      recipients: [
        { participantId: f.agent.principal.principalId, reason: "mention" },
      ],
      idempotencyKey: "human-reply",
    });
    const held = P.WorkerMessagePostResponseSchema.parse(
      await (
        await f.call("messages/post", { channel: "dm:@human", body: "Third" })
      ).json(),
    );
    assert.equal("state" in held ? held.state : "posted", "held");
    assert.equal(
      f.database
        .prepare(
          "SELECT count(*) AS n FROM held_message_drafts WHERE room_id=?",
        )
        .get(roomId)!.n,
      1,
    );
  } finally {
    await f.close();
  }
});

test("an Agent cannot address a principal it shares no Room with, and the Human path is unchanged", async () => {
  const f = await fixture();
  try {
    for (const channel of ["dm:@foreign", "dm:@nobody"]) {
      const refused = await f.call("messages/post", {
        channel,
        body: "Should not open",
      });
      assert.equal(refused.status, 404, await refused.clone().text());
      const refusedResolve = await f.call("rooms/resolve", { channel });
      assert.equal(refusedResolve.status, 404);
    }
    assert.equal(
      f.database
        .prepare("SELECT count(*) AS n FROM rooms WHERE kind='direct'")
        .get()!.n,
      0,
    );
    // POST /rooms/direct/open keeps its Human semantics.
    const dm = f.kernel.openDirectRoom(f.actor, {
      workspaceId: f.workspace.workspace.workspaceId,
      peerPrincipalId: f.outsider.principal.principalId,
      basedOnControlRoomSeq: f.kernel.sync(f.actor, {
        roomId: f.workspace.controlRoom.roomId,
        consumerId: "head",
      }).latestRoomSeq,
      idempotencyKey: "human-opened",
    });
    assert.equal(dm.kind, "direct");
    // …and that DM is still not the Agent's to address.
    assert.equal(
      (await f.call("rooms/resolve", { channel: "dm:@foreign" })).status,
      404,
    );
  } finally {
    await f.close();
  }
});
