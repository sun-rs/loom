import assert from "node:assert/strict";
import test from "node:test";

import {
  INSTANCE_RUNTIME_HINT_TOPIC,
  RoomKernel,
  type AuthenticatedHostContext,
} from "../src/index.ts";
import {
  claimInstanceRun,
  roleInstanceFixture,
  type RoleInstanceFixture,
} from "./role-instance-fixture.ts";

/**
 * Owner 2026-09-27: a Role instance's warm runtime is started when the
 * instance is created, not at its first message. The Kernel never starts a
 * process: it records a durable Host hint (Outbox) in the instantiation
 * transaction and answers a read-only prewarm plan — the placement the
 * instance's next turn would get now — so the Host launches exactly what the
 * first turn would reuse. Removal records the retire hint. Every assertion
 * reads Kernel state; no provider process exists here.
 */

const counts = (f: RoleInstanceFixture) =>
  Object.fromEntries(
    [
      "placements",
      "activations",
      "run_attempts",
      "room_events",
      "instance_runtimes",
    ].map((table) => [
      table,
      Number(
        f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n as number,
      ),
    ]),
  );

function claimAfterWake(f: RoleInstanceFixture, key: string) {
  f.kernel.postMessage(f.actor, {
    body: "please review",
    idempotencyKey: key,
    recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
    roomId: f.home.roomId,
  });
  return claimInstanceRun(f);
}

function leaseHints(kernel: RoomKernel) {
  const hints: Record<string, unknown>[] = [];
  for (;;) {
    const entry = kernel.leaseNextOutbox({
      dispatcherId: "test-prewarm",
      leaseMs: 60_000,
      topics: [INSTANCE_RUNTIME_HINT_TOPIC],
    });
    if (entry === null) return hints;
    hints.push(entry.payload);
    kernel.acknowledgeOutboxPublished({
      dispatcherId: "test-prewarm",
      outboxId: entry.outboxId,
    });
  }
}

test("instantiating a Role records a durable prewarm hint for the Host in the same transaction", () => {
  const f = roleInstanceFixture();
  try {
    assert.deepEqual(leaseHints(f.kernel), [
      {
        action: "prewarm",
        channelId: f.home.roomId,
        participantId: f.instance.instanceId,
      },
    ]);
    // An idempotent replay adds no second hint.
    const request = {
      basedOnRoomSeq: f.head(f.home.roomId),
      channelId: f.home.roomId,
      idempotencyKey: "another",
      roleId: f.role.roleId,
    };
    const another = f.kernel.roles.instantiate(f.actor, request).instance;
    assert.equal(
      f.kernel.roles.instantiate(f.actor, request).deduplicated,
      true,
    );
    assert.deepEqual(leaseHints(f.kernel), [
      {
        action: "prewarm",
        channelId: f.home.roomId,
        participantId: another.instanceId,
      },
    ]);
  } finally {
    f.close();
  }
});

test("the prewarm plan is read-only and names the placement, agent context and session generation the first turn gets", () => {
  const f = roleInstanceFixture();
  try {
    const before = counts(f);
    const plan = f.kernel.instancePrewarm.plan(f.host, {
      participantId: f.instance.instanceId,
    });
    assert.equal(plan.kind, "ready", JSON.stringify(plan));
    if (plan.kind !== "ready") return;
    assert.deepEqual(counts(f), before, "planning writes nothing");
    assert.equal(plan.roomId, f.home.roomId);
    assert.equal(plan.placement.participantId, f.instance.instanceId);
    assert.equal(plan.placement.hostId, f.host.hostId);
    assert.equal(plan.placement.hostInstanceId, f.host.instanceId);
    assert.equal(plan.agent.instanceChannelId, f.home.roomId);
    assert.equal(plan.agent.instanceSessionGeneration, 0);
    assert.equal(plan.agent.instanceSessionRequired, false);
    assert.equal(plan.contextManifest.participantId, f.instance.instanceId);
    assert.equal(plan.contextManifest.runAttemptId, plan.runAttemptId);
    assert.equal(plan.contextManifest.activationId, plan.activationId);
    assert.deepEqual(plan.limits, {
      hostMaxConcurrent: 1,
      hostReserved: 0,
      runtimeProfileMaxConcurrent: 1,
      runtimeProfileReserved: 0,
    });

    // The first real turn: every launch identity the Host keys a warm
    // runtime by is the same.
    const claimed = claimAfterWake(f, "first-turn");
    const real = f.db
      .prepare("SELECT decision_json FROM placements WHERE activation_id=?")
      .get(claimed.activation.activationId)!;
    const placement = JSON.parse(String(real.decision_json)) as Record<
      string,
      unknown
    >;
    for (const key of [
      "runtimeOfferId",
      "runtimeOfferObservationId",
      "runtimeProfileRevisionId",
      "runtimeProfileDigest",
      "workspaceDefinitionId",
      "workspaceMountRevisionId",
      "workspaceMountDigest",
      "resolvedModel",
      "toolAccessMode",
      "agentDefinitionRevisionId",
    ])
      assert.deepEqual(
        (plan.placement as Record<string, unknown>)[key],
        placement[key],
        key,
      );
    assert.deepEqual(plan.agent, claimed.agentContext);
  } finally {
    f.close();
  }
});

test("no prewarm plan while the instance is busy, the run caps are full, it is removed, or the Host does not own it", () => {
  const f = roleInstanceFixture();
  try {
    const plan = () =>
      f.kernel.instancePrewarm.plan(f.host, {
        participantId: f.instance.instanceId,
      });
    const running = claimAfterWake(f, "busy");
    assert.deepEqual(plan(), {
      kind: "skipped",
      reason: "placement_hold:lane_busy",
    });
    running.finish(0);

    // A second instance fills the Host cap (1): the first is not prewarmed.
    const second = f.kernel.roles.instantiate(f.actor, {
      basedOnRoomSeq: f.head(f.home.roomId),
      channelId: f.home.roomId,
      idempotencyKey: "second",
      roleId: f.role.roleId,
    }).instance.instanceId;
    f.kernel.postMessage(f.actor, {
      body: "work",
      idempotencyKey: "wake-second",
      recipients: [{ participantId: second, reason: "mention" }],
      roomId: f.home.roomId,
    });
    assert.ok(f.kernel.scheduleNextPlacement({ leaseMs: 600_000 }));
    assert.deepEqual(plan(), {
      kind: "skipped",
      reason: "placement_hold:capacity_exhausted",
    });

    // Another Host credential never gets a plan for this instance.
    const stranger: AuthenticatedHostContext =
      f.kernel.authenticateHostAccessToken(
        f.kernel.provisionHostCredential({
          hostId: "other-host",
          participantIds: [
            f.kernel.provisionPrincipal({ handle: "other", kind: "agent" })
              .principal.principalId,
          ],
        }).accessToken,
      );
    assert.throws(() =>
      f.kernel.instancePrewarm.plan(stranger, {
        participantId: f.instance.instanceId,
      }),
    );
  } finally {
    f.close();
  }
});

test("removing an instance records the retire hint and ends its prewarm eligibility", () => {
  const f = roleInstanceFixture();
  try {
    leaseHints(f.kernel);
    f.kernel.removeRoomMember(f.actor, {
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "remove",
      principalId: f.instance.instanceId,
      roomId: f.home.roomId,
    });
    assert.deepEqual(leaseHints(f.kernel), [
      {
        action: "retire",
        channelId: f.home.roomId,
        participantId: f.instance.instanceId,
      },
    ]);
    assert.deepEqual(
      f.kernel.instancePrewarm.plan(f.host, {
        participantId: f.instance.instanceId,
      }),
      { kind: "skipped", reason: "instance_inactive" },
    );
    // A Human member leaving a Channel is no instance: no hint.
    const peer = f.kernel.provisionPrincipal({ handle: "peer", kind: "human" });
    f.kernel.addRoomMember(f.actor, {
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "add-peer",
      principalId: peer.principal.principalId,
      role: "member",
      roomId: f.home.roomId,
    });
    f.kernel.removeRoomMember(f.actor, {
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "remove-peer",
      principalId: peer.principal.principalId,
      roomId: f.home.roomId,
    });
    assert.deepEqual(leaseHints(f.kernel), []);
  } finally {
    f.close();
  }
});

test("full review 2 batch 1 #4: a removed instance or one in an archived Channel cannot register a warm runtime", () => {
  const register = (f: RoleInstanceFixture, id: string) =>
    f.kernel.instanceRuntimes.register(f.host, {
      driver: "codex",
      instanceRuntimeId: id,
      participantId: f.instance.instanceId,
    });
  const removed = roleInstanceFixture();
  try {
    removed.kernel.removeRoomMember(removed.actor, {
      basedOnRoomSeq: removed.head(removed.home.roomId),
      idempotencyKey: "remove",
      principalId: removed.instance.instanceId,
      roomId: removed.home.roomId,
    });
    assert.throws(
      () => register(removed, "instrt_after_removal"),
      /no longer an active member/u,
    );
    assert.equal(
      Number(
        removed.db.prepare("SELECT COUNT(*) AS n FROM instance_runtimes").get()!
          .n,
      ),
      0,
      "no runtime row for a removed instance",
    );
  } finally {
    removed.close();
  }
  const archived = roleInstanceFixture();
  try {
    archived.kernel.archiveWorkspaceRoom(archived.actor, {
      basedOnRoomSeq: archived.head(archived.home.roomId),
      idempotencyKey: "archive",
      roomId: archived.home.roomId,
    });
    assert.throws(
      () => register(archived, "instrt_after_archive"),
      /no longer an active member/u,
    );
    archived.kernel.unarchiveWorkspaceRoom(archived.actor, {
      basedOnRoomSeq: archived.head(archived.home.roomId),
      idempotencyKey: "unarchive",
      roomId: archived.home.roomId,
    });
    assert.equal(
      register(archived, "instrt_active_again").state,
      "starting",
      "an active member registers as before",
    );
  } finally {
    archived.close();
  }
});

test("recently active instances are the Host's active Role instances with a RunAttempt inside the window", () => {
  let nowMs = Date.parse("2026-09-27T08:00:00.000Z");
  const f = roleInstanceFixture({ now: () => new Date(nowMs) });
  try {
    const recent = (hours: number) =>
      f.kernel.instancePrewarm.recentlyActive(f.host, {
        since: new Date(nowMs - hours * 3_600_000).toISOString(),
      });
    assert.deepEqual(recent(24), [], "no run yet");
    claimAfterWake(f, "recent").finish(0);
    nowMs += 5 * 3_600_000;
    assert.deepEqual(recent(24), [f.instance.instanceId]);
    assert.deepEqual(recent(4), [], "outside the window");
    f.detachFromChannel();
    assert.deepEqual(recent(24), [], "a removed instance is not prewarmed");
  } finally {
    f.close();
  }
});
