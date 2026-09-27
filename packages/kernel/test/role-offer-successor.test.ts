import assert from "node:assert/strict";
import test from "node:test";

import { roleInstanceFixture } from "./role-instance-fixture.ts";

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
