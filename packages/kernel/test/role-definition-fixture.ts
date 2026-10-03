import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import type { RoomKernel } from "@rah-os/kernel";

/** Only for execution fixtures with pre-bound fake Host principals/policies.
 * Preserve their exact IDs, policies and handles; add canonical Role provenance
 * after fixture membership setup and before delivery. Role creation/instantiation
 * itself is tested through APIs.
 */
export function bindRoleDefinitionFixture(
  kernel: RoomKernel,
  actor: Parameters<RoomKernel["roles"]["create"]>[0],
  databasePath: string,
  agentId: string,
  channelId: string,
  runtimeOfferId: string,
) {
  const detail = kernel.getWorkspaceAgentManagementView(actor, agentId);
  const { controlRoomId, participantId } = detail.agent.definition;
  const revision = detail.agent.currentRevision;
  const role = kernel.roles.create(actor, {
    controlRoomId,
    basedOnRoomSeq: kernel.sync(actor, {
      roomId: controlRoomId,
      afterSeq: 0,
      consumerId: "role-fixture",
    }).latestRoomSeq,
    idempotencyKey: `fixture-role-${agentId}`,
    configuration: {
      displayName: revision.displayName ?? detail.agent.handle,
      handle: detail.agent.handle,
      role: revision.role,
      instructions: revision.instructions ?? "Fake Worker fixture.",
      modelIntent: { fallback: "disabled" },
      runtimeOfferId,
      toolAccessMode: "full_access",
    },
  }).role;
  const db = new DatabaseSync(databasePath);
  try {
    db.prepare("INSERT INTO role_instances VALUES(?,?,?,?,?)").run(
      participantId,
      agentId,
      role.roleId,
      role.roleRevisionId,
      channelId,
    );
    assert.equal(
      db
        .prepare("SELECT channel_id FROM role_instances WHERE instance_id=?")
        .get(participantId)?.channel_id,
      channelId,
    );
  } finally {
    db.close();
  }
}
