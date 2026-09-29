import assert from "node:assert/strict";
import test from "node:test";

import {
  roleInstanceFixture,
  startInstanceRun,
} from "./role-instance-fixture.ts";

/**
 * A user-installed CLI updates itself (evidence: Claude Code 2.1.282 →
 * 2.1.283 on 2026-09-27); the Host then publishes a new RuntimeProfile
 * revision as a new Offer, and the Role's pinned Offer becomes unavailable.
 * The daemon already moves existing Agents to the successor at startup
 * (`local-workbench-runtime-bindings.ts`). Instantiating the Role must follow
 * the same rule: the available Offer of the *same* RuntimeProfile on the
 * *same* Host (exact identity, never a name prefix) replaces the superseded
 * one. A different profile is never substituted — that would switch CLI.
 */

function publish(
  f: ReturnType<typeof roleInstanceFixture>,
  input: {
    runtimeOfferId: string;
    runtimeProfileId: string;
    runtimeProfileRevisionId: string;
    state: "available" | "unavailable";
  },
) {
  const now = new Date();
  // The fixture's original Offer keeps its original digest (Offers are immutable).
  const digest = `sha256:${(input.runtimeOfferId === "offer" ? "a" : "b").repeat(64)}`;
  f.kernel.publishRuntimeOffer(f.host, {
    hostId: f.host.hostId,
    hostInstanceId: f.host.instanceId,
    runtimeOfferId: input.runtimeOfferId,
    runtimeProfileId: input.runtimeProfileId,
    runtimeProfileRevisionId: input.runtimeProfileRevisionId,
    revisionDigest: digest,
    protocolFamily: "rah-worker-process/v1",
    state: input.state,
    observedAt: now.toISOString(),
    leaseUntil: new Date(now.getTime() + 600_000).toISOString(),
    isolation: { evidence: "declared", level: "none" },
    maxConcurrent: 2,
    capacityPoolIds: [],
    capabilityEvidence: [],
    certificationRefs: [],
    modelBindingDescriptors: [],
    supportedToolAccessModes: ["full_access"],
    workspaceMountDescriptors: [
      {
        workspaceDefinitionId: f.workspace.workspace.workspaceId,
        workspaceMountRevisionId: "mount",
        workspaceMountDigest: digest,
        modes: ["in_place"],
      },
    ],
  });
}

function instantiateIn(
  f: ReturnType<typeof roleInstanceFixture>,
  slug: string,
) {
  const room = f.channel(slug);
  return f.kernel.roles.instantiate(f.actor, {
    roleId: f.role.roleId,
    channelId: room.roomId,
    basedOnRoomSeq: f.head(room.roomId),
    idempotencyKey: `instance-${slug}`,
  });
}

test("a Role pinned to a superseded Offer instantiates on the same profile's available successor", () => {
  const f = roleInstanceFixture();
  try {
    publish(f, {
      runtimeOfferId: "offer-v2",
      runtimeProfileId: "profile",
      runtimeProfileRevisionId: "profile-v2",
      state: "available",
    });
    publish(f, {
      runtimeOfferId: "offer",
      runtimeProfileId: "profile",
      runtimeProfileRevisionId: "profile-v1",
      state: "unavailable",
    });
    const created = instantiateIn(f, "after-update");
    const policy = f.kernel.getExecutionPolicyRevision(
      created.agent.currentRevision.executionPolicyRevisionId,
    );
    assert.deepEqual(policy.required.allowedOfferIds, ["offer-v2"]);
  } finally {
    f.close();
  }
});

test("another profile's available Offer is never substituted", () => {
  const f = roleInstanceFixture();
  try {
    publish(f, {
      runtimeOfferId: "other-cli",
      runtimeProfileId: "other-profile",
      runtimeProfileRevisionId: "other-v1",
      state: "available",
    });
    publish(f, {
      runtimeOfferId: "offer",
      runtimeProfileId: "profile",
      runtimeProfileRevisionId: "profile-v1",
      state: "unavailable",
    });
    assert.throws(
      () => instantiateIn(f, "no-successor"),
      /RuntimeOffer offer is not currently available/u,
    );
  } finally {
    f.close();
  }
});

test("an available pinned Offer is used as is", () => {
  const f = roleInstanceFixture();
  try {
    publish(f, {
      runtimeOfferId: "offer-v2",
      runtimeProfileId: "profile",
      runtimeProfileRevisionId: "profile-v2",
      state: "available",
    });
    const created = instantiateIn(f, "pinned-still-live");
    const policy = f.kernel.getExecutionPolicyRevision(
      created.agent.currentRevision.executionPolicyRevisionId,
    );
    assert.deepEqual(policy.required.allowedOfferIds, ["offer"]);
  } finally {
    f.close();
  }
});

function configureInput(
  f: ReturnType<typeof roleInstanceFixture>,
  runtimeOfferId: string,
) {
  const current = f.kernel.getWorkspaceAgentManagementView(f.actor, f.agentId);
  return {
    action: "configure" as const,
    agentId: f.agentId,
    basedOnRoomSeq: f.head(f.controlRoomId),
    idempotencyKey: "configure-successor",
    handle: current.agent.handle,
    displayName: "Reviewer",
    instructions: "Review only.",
    role: "Review",
    runtimeOfferId,
    modelIntent: {
      exactBindingIds: ["model-v2"],
      reasoning: "low" as const,
      fallback: "disabled" as const,
    },
  };
}

test("instance model and effort edits accept a same-Host same-profile successor without resetting the bound session", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    f.kernel.instanceSessions.record(f.host, {
      runAttemptId: work.run.runAttemptId,
      runtimeRunId: work.runtime.runtimeRunId,
    });
    work.finish(0);
    const binding = () =>
      f.db
        .prepare("SELECT * FROM role_instance_sessions WHERE instance_id=?")
        .get(f.instance.instanceId);
    const before = binding();
    publish(f, {
      runtimeOfferId: "offer-v2",
      runtimeProfileId: "profile",
      runtimeProfileRevisionId: "profile-v2",
      state: "available",
    });
    publish(f, {
      runtimeOfferId: "offer",
      runtimeProfileId: "profile",
      runtimeProfileRevisionId: "profile-v1",
      state: "unavailable",
    });
    const input = configureInput(f, "offer-v2");
    const result = f.kernel.manageWorkspaceAgent(f.actor, input);
    assert.deepEqual(result.policy?.required.allowedOfferIds, ["offer-v2"]);
    assert.deepEqual(result.policy?.modelIntent, input.modelIntent);
    assert.deepEqual(binding(), before);
    assert.equal(result.agent.definition.participantId, f.instance.instanceId);
    assert.equal(
      f.kernel.manageWorkspaceAgent(f.actor, input).deduplicated,
      true,
    );
    assert.throws(
      () =>
        f.kernel.manageWorkspaceAgent(f.actor, {
          ...input,
          modelIntent: { ...input.modelIntent, reasoning: "high" },
        }),
      /idempotency/i,
    );
  } finally {
    f.close();
  }
});

test("instance configuration still refuses a different runtime profile", () => {
  const f = roleInstanceFixture();
  try {
    publish(f, {
      runtimeOfferId: "other-offer",
      runtimeProfileId: "other-cli",
      runtimeProfileRevisionId: "other-v1",
      state: "available",
    });
    assert.throws(
      () =>
        f.kernel.manageWorkspaceAgent(
          f.actor,
          configureInput(f, "other-offer"),
        ),
      /instance cannot switch runtime/i,
    );
  } finally {
    f.close();
  }
});

test("instance configuration refuses the same profile on another Host", () => {
  const f = roleInstanceFixture();
  try {
    const host = f.kernel.authenticateHostAccessToken(
      f.kernel.provisionHostCredential({
        hostId: "other-host",
        participantIds: [f.instance.instanceId],
      }).accessToken,
    );
    f.kernel.heartbeatHost(host);
    publish(
      { ...f, host },
      {
        runtimeOfferId: "other-host-offer",
        runtimeProfileId: "profile",
        runtimeProfileRevisionId: "profile-v2",
        state: "available",
      },
    );
    const before = f.kernel.getWorkspaceAgentManagementView(f.actor, f.agentId)
      .agent.currentRevision;
    assert.throws(
      () =>
        f.kernel.manageWorkspaceAgent(
          f.actor,
          configureInput(f, "other-host-offer"),
        ),
      /instance cannot switch runtime/i,
    );
    assert.deepEqual(
      f.kernel.getWorkspaceAgentManagementView(f.actor, f.agentId).agent
        .currentRevision,
      before,
    );
  } finally {
    f.close();
  }
});

test("instance configuration never bypasses successor availability checks", () => {
  const f = roleInstanceFixture();
  try {
    publish(f, {
      runtimeOfferId: "offer-v2",
      runtimeProfileId: "profile",
      runtimeProfileRevisionId: "profile-v2",
      state: "unavailable",
    });
    assert.throws(
      () =>
        f.kernel.manageWorkspaceAgent(f.actor, configureInput(f, "offer-v2")),
      /not currently available/i,
    );
  } finally {
    f.close();
  }
});
