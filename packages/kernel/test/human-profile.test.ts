import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHumanApplicationPort, RoomKernel } from "../src/index.ts";

test("Human profile is workspace-scoped, current, and never guesses Computer ownership", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-human-profile-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  try {
    kernel.initialize();
    const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    const outsider = kernel.provisionPrincipal({
      handle: "outsider",
      kind: "human",
    });
    const actor = kernel.authenticateHumanAccessToken(owner.accessToken);
    const other = kernel.authenticateHumanAccessToken(outsider.accessToken);
    const workspace = kernel.createWorkspace(actor, {
      name: "Profile",
      slug: "profile",
      idempotencyKey: "workspace",
    });
    const port = createHumanApplicationPort(kernel);
    const request = {
      workspaceId: workspace.workspace.workspaceId,
      principalId: actor.principalId,
    };
    const profile = port.getHumanProfile(actor, request);
    assert.equal(profile.principal.principalId, actor.principalId);
    assert.equal(profile.membership.role, "owner");
    assert.ok(profile.membership.joinedAt);
    assert.deepEqual(profile.createdAgentDefinitionIds, []);
    assert.equal(profile.canReadCreatedAgents, true);
    assert.equal("computers" in profile, false);
    assert.equal("email" in profile.principal, false);
    assert.throws(
      () => port.getHumanProfile(other, request),
      /unavailable|member|access/i,
    );
    assert.throws(
      () =>
        port.getHumanProfile(actor, {
          ...request,
          principalId: other.principalId,
        }),
      /unavailable|member/i,
    );
    assert.throws(
      () => port.getHumanProfile(actor, { ...request, workspaceId: "missing" }),
      /unavailable|access/i,
    );
    kernel.updateAuthenticatedPrincipal(actor, {
      avatarKey: "avatar-03",
      displayName: "New name",
    });
    assert.equal(
      port.getHumanProfile(actor, request).principal.displayName,
      "New name",
    );
    const snapshot = kernel.sync(actor, {
      roomId: workspace.controlRoom.roomId,
      afterSeq: 0,
      consumerId: "profile-snapshot",
    }).snapshot;
    const visibleOwner = snapshot?.members.find(
      (p) => p.principalId === actor.principalId,
    );
    assert.equal(
      visibleOwner?.displayName,
      "New name",
      "Room members must carry current display name for message mentions",
    );
    assert.equal(visibleOwner?.avatarKey, "avatar-03");
    kernel.updateAuthenticatedPrincipal(actor, {
      avatarKey: null,
      displayName: "Cleared",
    });
    assert.equal(
      port.getHumanProfile(actor, request).principal.avatarKey,
      undefined,
    );
    kernel.addMember(actor, {
      roomId: workspace.controlRoom.roomId,
      principalId: other.principalId,
    });
    const memberView = port.getHumanProfile(other, request);
    assert.equal(memberView.canReadCreatedAgents, false);
    assert.deepEqual(memberView.createdAgentDefinitionIds, []);
    const agent = kernel.provisionPrincipal({ handle: "agent", kind: "agent" });
    kernel.addMember(actor, {
      roomId: workspace.controlRoom.roomId,
      principalId: agent.principal.principalId,
    });
    assert.throws(
      () =>
        port.getHumanProfile(
          kernel.authenticateAccessToken(agent.accessToken),
          request,
        ),
      /Human|human/,
    );
    const latest = kernel.sync(actor, {
      roomId: workspace.controlRoom.roomId,
      afterSeq: 0,
      consumerId: "human-profile-test",
    }).latestRoomSeq;
    kernel.removeRoomMember(actor, {
      roomId: workspace.controlRoom.roomId,
      principalId: other.principalId,
      basedOnRoomSeq: latest,
      idempotencyKey: "remove-reader",
    });
    assert.throws(
      () => port.getHumanProfile(other, request),
      /member|unavailable/i,
      "a previously authorized reader loses access immediately",
    );
  } finally {
    kernel.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
