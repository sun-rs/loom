import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RoomKernel } from "../src/index.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

test("created Agents come from revision-one identity provenance and exclude tombstones", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-created-agents-"));
  const databasePath = join(directory, "room.db");
  const options = {
    databasePath,
    now: () => new Date("2026-09-02T00:00:00.000Z"),
  };
  let kernel = new RoomKernel(options);
  try {
    kernel.initialize();
    const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    const parent = kernel.provisionPrincipal({
      handle: "parent",
      kind: "agent",
    });
    const child = kernel.provisionPrincipal({ handle: "child", kind: "agent" });
    let actor = kernel.authenticateAccessToken(owner.accessToken);
    const workspace = kernel.createWorkspace(actor, {
      idempotencyKey: "workspace",
      name: "Created Agents",
      slug: "created-agents",
    });
    kernel.addMember(actor, {
      principalId: parent.principal.principalId,
      roomId: workspace.controlRoom.roomId,
    });
    kernel.addMember(actor, {
      principalId: child.principal.principalId,
      roomId: workspace.controlRoom.roomId,
    });
    const currentSeq = () =>
      kernel.sync(actor, {
        afterSeq: 0,
        consumerId: "created-agent-test",
        roomId: workspace.controlRoom.roomId,
      }).latestRoomSeq;
    const policy = kernel.createExecutionPolicy(actor, {
      basedOnRoomSeq: currentSeq(),
      controlRoomId: workspace.controlRoom.roomId,
      idempotencyKey: "policy",
      modelIntent: { fallback: "disabled" },
      preferred: [],
      required: {
        allowedProtocolFamilies: ["rah-worker-process/v1"],
        capabilities: [],
        minimumIsolation: "none",
        workspaceMode: "in_place",
      },
      retryPolicyRef: {
        artifactId: "retry-policy",
        contentDigest: digest("a"),
        versionId: "retry-policy-v1",
      },
      sessionPolicy: "fresh",
    });
    const create = (participantId: string, idempotencyKey: string) =>
      kernel.createAgentDefinition(actor, {
        basedOnRoomSeq: currentSeq(),
        controlRoomId: workspace.controlRoom.roomId,
        executionPolicyRevisionId: policy.policy.executionPolicyRevisionId,
        idempotencyKey,
        instructionRefs: [],
        memoryPolicyRef: {
          artifactId: "memory-policy",
          contentDigest: digest("b"),
          versionId: "memory-policy-v1",
        },
        participantId,
        role: "Agent",
        skillRefs: [],
      });
    const parentDefinition = create(
      parent.principal.principalId,
      "parent-definition",
    );
    const childDefinition = create(
      child.principal.principalId,
      "child-definition",
    );
    kernel.close();

    // Simulate a source-backed imported Agent-created relationship. The public
    // creation command deliberately remains Human-only; this test exercises the
    // read model without granting new provisioning authority.
    const database = new DatabaseSync(databasePath);
    const row = database
      .prepare(
        "SELECT agent_definition_revision_id, definition_json FROM agent_definition_revisions WHERE agent_definition_id = ? AND revision = 1",
      )
      .get(childDefinition.definition.agentDefinitionId)!;
    const definition = JSON.parse(String(row.definition_json)) as Record<
      string,
      unknown
    >;
    definition.createdBy = parent.principal.principalId;
    database
      .prepare(
        "UPDATE agent_definition_revisions SET created_by = ?, definition_json = ? WHERE agent_definition_revision_id = ?",
      )
      .run(
        parent.principal.principalId,
        JSON.stringify(definition),
        String(row.agent_definition_revision_id),
      );
    database.close();

    kernel = new RoomKernel(options);
    kernel.initialize();
    actor = kernel.authenticateAccessToken(owner.accessToken);
    const detail = kernel.getWorkspaceAgentManagementView(
      actor,
      parentDefinition.definition.agentDefinitionId,
    );
    assert.equal(detail.creator?.principalId, owner.principal.principalId);
    assert.deepEqual(
      kernel.humanProfiles.get(actor, {
        workspaceId: workspace.workspace.workspaceId,
        principalId: owner.principal.principalId,
      }).createdAgentDefinitionIds,
      [parentDefinition.definition.agentDefinitionId],
      "Human and Agent views use the same revision-one creation edge",
    );
    assert.deepEqual(
      detail.createdAgents.map((agent) => agent.definition.agentDefinitionId),
      [childDefinition.definition.agentDefinitionId],
    );

    const outsider = kernel.provisionPrincipal({
      handle: "outsider",
      kind: "human",
    });
    assert.throws(() =>
      kernel.getWorkspaceAgentManagementView(
        kernel.authenticateAccessToken(outsider.accessToken),
        parentDefinition.definition.agentDefinitionId,
      ),
    );

    kernel.addMember(actor, {
      roomId: workspace.controlRoom.roomId,
      principalId: outsider.principal.principalId,
    });
    kernel.setRoomMemberRole(actor, {
      roomId: workspace.controlRoom.roomId,
      principalId: outsider.principal.principalId,
      role: "admin",
      basedOnRoomSeq: currentSeq(),
      idempotencyKey: "editor-admin",
    });
    const editor = kernel.authenticateHumanAccessToken(outsider.accessToken);
    const edited = kernel.manageWorkspaceAgent(editor, {
      action: "update_profile",
      field: "displayName",
      value: "Edited by admin",
      agentDefinitionId: parentDefinition.definition.agentDefinitionId,
      expectedRevisionId: parentDefinition.definition.currentRevisionId,
      basedOnRoomSeq: currentSeq(),
      idempotencyKey: "other-editor",
    });
    assert.equal(edited.agent.currentRevision.createdBy, editor.principalId);
    assert.deepEqual(
      kernel.humanProfiles.get(actor, {
        workspaceId: workspace.workspace.workspaceId,
        principalId: actor.principalId,
      }).createdAgentDefinitionIds,
      [parentDefinition.definition.agentDefinitionId],
    );
    assert.deepEqual(
      kernel.humanProfiles.get(actor, {
        workspaceId: workspace.workspace.workspaceId,
        principalId: editor.principalId,
      }).createdAgentDefinitionIds,
      [],
    );

    kernel.manageWorkspaceAgent(actor, {
      action: "set_state",
      agentDefinitionId: childDefinition.definition.agentDefinitionId,
      basedOnRoomSeq: currentSeq(),
      idempotencyKey: "child-disable",
      state: "disabled",
    });
    kernel.manageWorkspaceAgent(actor, {
      action: "set_state",
      agentDefinitionId: childDefinition.definition.agentDefinitionId,
      basedOnRoomSeq: currentSeq(),
      idempotencyKey: "child-tombstone",
      state: "tombstoned",
    });
    assert.deepEqual(
      kernel.getWorkspaceAgentManagementView(
        actor,
        parentDefinition.definition.agentDefinitionId,
      ).createdAgents,
      [],
    );
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
