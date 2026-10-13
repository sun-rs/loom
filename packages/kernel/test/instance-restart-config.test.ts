import assert from "node:assert/strict";
import test from "node:test";
import {
  roleInstanceFixture,
  startInstanceRun,
} from "./role-instance-fixture.ts";
import { readAgentDefinition } from "../src/workspace-agent-management.ts";

test("explicit restart adopts a selected Role revision atomically and keeps identity/history", () => {
  const f = roleInstanceFixture();
  try {
    const revised = f.kernel.roles.revise(f.actor, {
      roleId: f.role.roleId,
      expectedRoleRevisionId: f.role.roleRevisionId,
      basedOnRoomSeq: f.head(f.controlRoomId),
      idempotencyKey: "rename",
      configuration: {
        ...f.role.configuration,
        displayName: "审查 Jerry",
        instructions: "new prompt",
      },
    }).role;
    const before = readAgentDefinition(f.db, f.agentId);
    f.kernel.roles.resetInstanceSession(f.actor, {
      instanceId: f.instance.instanceId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "keep",
    });
    assert.deepEqual(readAgentDefinition(f.db, f.agentId), before);
    const input = {
      instanceId: f.instance.instanceId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "adopt",
      adoptRoleRevisionId: revised.roleRevisionId,
    };
    const result = f.kernel.roles.resetInstanceSession(f.actor, input);
    const after = readAgentDefinition(f.db, f.agentId);
    assert.equal(after.currentRevision.instructions, "new prompt");
    assert.equal(after.currentRevision.displayName, "审查 Jerry-1");
    assert.equal(after.definition.participantId, f.instance.instanceId);
    assert.equal(result.sessionGeneration, 2);
    assert.equal(
      f.kernel.roles.resetInstanceSession(f.actor, {
        ...input,
        basedOnRoomSeq: 0,
      }).deduplicated,
      true,
    );
    assert.throws(
      () =>
        f.kernel.roles.resetInstanceSession(f.actor, {
          ...input,
          adoptRoleRevisionId: f.role.roleRevisionId,
        }),
      /idempotency/i,
    );
    const instances = f.kernel.roles.list(f.actor, {
      controlRoomId: f.controlRoomId,
    }).instances;
    assert.equal(instances[0]!.roleRevisionId, revised.roleRevisionId);
    assert.equal(instances[0]!.isCurrent, true);
    assert.ok(
      f.db
        .prepare("SELECT 1 FROM rooms WHERE room_id=?")
        .get(f.privateBox.roomId),
    );
  } finally {
    f.close();
  }
});

test("adoption rejects stale/deleted Role and live or reserved execution without partial changes", () => {
  const f = roleInstanceFixture();
  try {
    const revised = f.kernel.roles.revise(f.actor, {
      roleId: f.role.roleId,
      expectedRoleRevisionId: f.role.roleRevisionId,
      basedOnRoomSeq: f.head(f.controlRoomId),
      idempotencyKey: "revise",
      configuration: { ...f.role.configuration, instructions: "changed" },
    }).role;
    const reset = (revision: string) =>
      f.kernel.roles.resetInstanceSession(f.actor, {
        instanceId: f.instance.instanceId,
        basedOnRoomSeq: f.head(f.home.roomId),
        idempotencyKey: "adopt",
        adoptRoleRevisionId: revision,
      });
    assert.throws(() => reset(f.role.roleRevisionId), /revision.*changed/i);
    const work = startInstanceRun(f);
    assert.throws(() => reset(revised.roleRevisionId), /running work/i);
    work.finish(0);
    f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "next",
      recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
      idempotencyKey: "next",
    });
    assert.ok(f.kernel.scheduleNextPlacement({ leaseMs: 600000 }));
    assert.throws(() => reset(revised.roleRevisionId), /leased|reserved/i);
    assert.equal(
      readAgentDefinition(f.db, f.agentId).currentRevision.instructions,
      "Review only.",
    );
    f.kernel.roles.delete(f.actor, {
      roleId: f.role.roleId,
      expectedRoleRevisionId: revised.roleRevisionId,
      basedOnRoomSeq: f.head(f.controlRoomId),
      idempotencyKey: "delete",
    });
    assert.throws(() => reset(revised.roleRevisionId), /deleted/i);
  } finally {
    f.close();
  }
});

test("CLI switch is allowed only by explicit restart and preserves current native overrides when keeping config", async () => {
  const f = roleInstanceFixture();
  try {
    const { currentRuntimeOfferFromRow } =
      await import("../src/runtime-offer-tool-access.ts");
    const {
      acceptedAt: _a,
      resolvedCertifications: _c,
      runtimeOfferObservationId: _o,
      runtimeOfferSnapshotDigest: _d,
      ...offer
    } = currentRuntimeOfferFromRow(
      f.db
        .prepare("SELECT * FROM runtime_offers WHERE runtime_offer_id='offer'")
        .get()!,
    );
    f.kernel.publishRuntimeOffer(f.host, {
      ...offer,
      runtimeOfferId: "other-cli",
      runtimeProfileId: "other-cli-profile",
      runtimeProfileRevisionId: "other-v1",
    });
    const current = f.kernel.getWorkspaceAgentManagementView(
      f.actor,
      f.agentId,
    );
    const configure = {
      ...f.role.configuration,
      action: "configure" as const,
      agentId: f.agentId,
      handle: current.agent.handle,
      displayName: current.agent.handle,
      runtimeOfferId: "other-cli",
      basedOnRoomSeq: f.head(f.controlRoomId),
      idempotencyKey: "native-switch",
    };
    assert.throws(
      () => f.kernel.manageWorkspaceAgent(f.actor, configure),
      /cannot switch runtime/i,
    );
    const revised = f.kernel.roles.revise(f.actor, {
      roleId: f.role.roleId,
      expectedRoleRevisionId: f.role.roleRevisionId,
      basedOnRoomSeq: f.head(f.controlRoomId),
      idempotencyKey: "cli-role",
      configuration: {
        ...f.role.configuration,
        runtimeOfferId: "other-cli",
        instructions: "another CLI",
      },
    }).role;
    f.kernel.roles.resetInstanceSession(f.actor, {
      instanceId: f.instance.instanceId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "cli-reset",
      adoptRoleRevisionId: revised.roleRevisionId,
    });
    const adopted = f.kernel.getWorkspaceAgentManagementView(
      f.actor,
      f.agentId,
    );
    assert.deepEqual(adopted.policy.required.allowedOfferIds, ["other-cli"]);
    assert.equal(adopted.agent.handle, current.agent.handle);
    f.kernel.roles.delete(f.actor, {
      roleId: f.role.roleId,
      expectedRoleRevisionId: revised.roleRevisionId,
      basedOnRoomSeq: f.head(f.controlRoomId),
      idempotencyKey: "delete",
    });
    f.kernel.roles.resetInstanceSession(f.actor, {
      instanceId: f.instance.instanceId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "keep-deleted",
    });
    assert.deepEqual(
      f.kernel.getWorkspaceAgentManagementView(f.actor, f.agentId),
      adopted,
    );
    f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "after switch",
      recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
      idempotencyKey: "after-switch",
    });
    const placement = f.kernel.scheduleNextPlacement({ leaseMs: 600000 });
    assert.ok(placement);
    const claim = f.kernel.claimNextPlacement(f.host, { leaseMs: 600000 });
    assert.ok(claim);
    assert.equal(claim.agentContext.instanceSessionGeneration, 2);
    assert.equal(claim.agentContext.instanceSessionRequired, false);
    assert.equal(
      claim.agentContext.agentDefinitionRevision.instructions,
      "another CLI",
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT runtime_profile_id FROM placements WHERE placement_id=?",
        )
        .get(placement.placementId)!.runtime_profile_id,
      "other-cli-profile",
    );
  } finally {
    f.close();
  }
});

test("keep uses actual native model overrides; failed adoption rolls back config and generation", () => {
  const f = roleInstanceFixture();
  try {
    const current = f.kernel.getWorkspaceAgentManagementView(
      f.actor,
      f.agentId,
    );
    f.kernel.manageWorkspaceAgent(f.actor, {
      ...f.role.configuration,
      action: "configure",
      agentId: f.agentId,
      handle: current.agent.handle,
      displayName: current.agent.handle,
      modelIntent: {
        exactBindingIds: ["native-override"],
        fallback: "disabled",
        reasoning: "low",
      },
      basedOnRoomSeq: f.head(f.controlRoomId),
      idempotencyKey: "native",
    });
    const actual = f.kernel.getWorkspaceAgentManagementView(f.actor, f.agentId);
    f.kernel.roles.resetInstanceSession(f.actor, {
      instanceId: f.instance.instanceId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "keep",
    });
    assert.deepEqual(
      f.kernel.getWorkspaceAgentManagementView(f.actor, f.agentId),
      actual,
    );
    const bad = f.kernel.roles.revise(f.actor, {
      roleId: f.role.roleId,
      expectedRoleRevisionId: f.role.roleRevisionId,
      basedOnRoomSeq: f.head(f.controlRoomId),
      idempotencyKey: "missing-cli",
      configuration: { ...f.role.configuration, runtimeOfferId: "missing" },
    }).role;
    const head = f.head(f.home.roomId);
    assert.throws(
      () =>
        f.kernel.roles.resetInstanceSession(f.actor, {
          instanceId: f.instance.instanceId,
          basedOnRoomSeq: head,
          idempotencyKey: "fail",
          adoptRoleRevisionId: bad.roleRevisionId,
        }),
      /not found/i,
    );
    assert.deepEqual(
      f.kernel.getWorkspaceAgentManagementView(f.actor, f.agentId),
      actual,
    );
    assert.equal(f.head(f.home.roomId), head);
    assert.equal(
      f.db
        .prepare(
          "SELECT generation FROM role_instance_sessions WHERE instance_id=?",
        )
        .get(f.instance.instanceId)!.generation,
      1,
    );
  } finally {
    f.close();
  }
});
