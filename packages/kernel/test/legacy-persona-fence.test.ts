import assert from "node:assert/strict";
import test from "node:test";

import { roleInstanceFixture } from "./role-instance-fixture.ts";

/**
 * Contract §2 (owner 2026-09-27 close-out): the legacy persona Agent — an
 * Agent definition that is not a Role instance — takes no part in evo
 * scheduling. The Kernel records no Inbox item and no Activation for it, so no
 * Host ever leases its work; a Role instance in the same Channel is scheduled
 * as before. The frozen frontend may still provision one (retiring endpoint).
 */
test("a legacy persona Agent gets no Inbox item or Activation; the Role instance beside it does", () => {
  // The product composition's setting (DaemonApplication).
  const f = roleInstanceFixture({ scheduleLegacyPersonas: false });
  try {
    const persona = f.kernel.provisionWorkspaceAgent(f.actor, {
      basedOnRoomSeq: f.head(f.controlRoomId),
      controlRoomId: f.controlRoomId,
      displayName: "Persona",
      handle: "persona",
      idempotencyKey: "persona",
      instructions: "FIXTURE persona; never runs.",
      modelIntent: { fallback: "disabled" as const },
      role: "Assistant",
      runtimeOfferId: "offer",
      sessionPolicy: "prefer_resume" as const,
    }).agent.definition.participantId;
    f.kernel.addMember(f.actor, {
      principalId: persona,
      roomId: f.home.roomId,
    });
    f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "both of you, please",
      idempotencyKey: "mention-both",
      recipients: [
        { participantId: persona, reason: "mention" },
        { participantId: f.instance.instanceId, reason: "mention" },
      ],
    });
    const direct = f.kernel.openDirectRoom(f.actor, {
      workspaceId: f.workspace.workspace.workspaceId,
      peerPrincipalId: persona,
      basedOnControlRoomSeq: f.head(f.controlRoomId),
      idempotencyKey: "persona-dm",
    });
    f.kernel.postMessage(f.actor, {
      roomId: direct.roomId,
      body: "a direct request",
      idempotencyKey: "persona-direct",
      recipients: [{ participantId: persona, reason: "dm" }],
    });
    const count = (table: string, participantId: string) =>
      Number(
        f.db
          .prepare(`SELECT count(*) AS n FROM ${table} WHERE participant_id=?`)
          .get(participantId)!.n,
      );
    assert.equal(count("inbox_items", persona), 0);
    assert.equal(count("activations", persona), 0);
    assert.equal(count("activations", f.instance.instanceId), 1);
    const leased = f.kernel.leaseNextActivation(f.host, { leaseMs: 60_000 });
    assert.equal(leased?.participantId, f.instance.instanceId);
    assert.equal(
      f.kernel.leaseNextActivation(f.host, { leaseMs: 60_000 }),
      null,
    );
  } finally {
    f.close();
  }
});
