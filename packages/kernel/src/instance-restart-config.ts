import { roleRuntimeOffer } from "./role-runtime-offer.ts";
import {
  RoleTemplateSchema,
  type InstanceSessionResetRequest,
} from "@rah-os/protocol";
import { ConflictError } from "./errors.ts";
import { integer, text } from "./sqlite-row.ts";
import { allocateInstanceName } from "./role-names.ts";
import {
  manageWorkspaceAgentTransaction,
  type WorkspaceAgentManagementOwner,
} from "./workspace-agent-management.ts";

/** Inside RoleCatalog's authenticated reset transaction, after run/cleanup fences. */
export function adoptInstanceRoleRevision(
  owner: WorkspaceAgentManagementOwner,
  input: InstanceSessionResetRequest,
): void {
  const db = owner.database;
  const row = db
    .prepare(
      `SELECT i.*,t.deleted_at,t.role_revision_id AS latest_revision_id,r.snapshot_json
    FROM role_instances i JOIN role_templates t ON t.role_id=i.role_id
    JOIN role_revisions r ON r.role_revision_id=t.role_revision_id WHERE i.instance_id=?`,
    )
    .get(input.instanceId)!;
  if (row.deleted_at != null) throw new ConflictError("Role has been deleted");
  if (row.latest_revision_id !== input.adoptRoleRevisionId)
    throw new ConflictError("Role revision changed; reload before restarting");
  if (
    !db
      .prepare("SELECT 1 FROM memberships WHERE principal_id=? AND room_id=?")
      .get(input.instanceId, row.channel_id!)
  )
    throw new ConflictError("Removed instance cannot adopt Role configuration");
  if (
    db
      .prepare(
        `SELECT 1 FROM activations WHERE participant_id=? AND state='leased'
    UNION ALL SELECT 1 FROM placements WHERE participant_id=? AND state='reserved' LIMIT 1`,
      )
      .get(input.instanceId, input.instanceId)
  )
    throw new ConflictError(
      "Instance has leased or reserved work; wait before adopting configuration",
    );
  const role = RoleTemplateSchema.parse(JSON.parse(text(row, "snapshot_json")));
  const old = RoleTemplateSchema.parse(
    JSON.parse(
      text(
        db
          .prepare(
            "SELECT snapshot_json FROM role_revisions WHERE role_revision_id=?",
          )
          .get(row.role_revision_id!)!,
        "snapshot_json",
      ),
    ),
  );
  const name =
    role.configuration.displayName === old.configuration.displayName
      ? text(
          db
            .prepare("SELECT handle FROM principals WHERE principal_id=?")
            .get(input.instanceId)!,
          "handle",
        )
      : allocateInstanceName(db, role.configuration.displayName);
  const { executionWorkspace: _workspace, ...configuration } =
    role.configuration;
  manageWorkspaceAgentTransaction(
    { ...owner, restartingInstanceId: input.instanceId },
    {
      ...configuration,
      runtimeOfferId: roleRuntimeOffer(
        db,
        configuration.runtimeOfferId,
        owner.now().getTime(),
      ).runtimeOfferId,
      action: "configure",
      agentId: text(row, "agent_id"),
      handle: name,
      displayName: name,
      basedOnRoomSeq:
        integer(
          db
            .prepare("SELECT next_seq FROM rooms WHERE room_id=?")
            .get(role.controlRoomId)!,
          "next_seq",
        ) - 1,
      idempotencyKey: `${input.idempotencyKey}:configuration`,
    },
  );
  db.prepare(
    "UPDATE role_instances SET role_revision_id=? WHERE instance_id=?",
  ).run(role.roleRevisionId, input.instanceId);
}
