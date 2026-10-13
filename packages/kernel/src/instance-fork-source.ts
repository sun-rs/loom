import type { DatabaseSync } from "node:sqlite";
import { RoleTemplateSchema } from "@rah-os/protocol";
import {
  requireHumanControlRoomManager,
  requireRoomManager,
} from "./collaboration-policy.ts";
import { ConflictError, NotFoundError, StaleContextError } from "./errors.ts";
import { text, integer } from "./sqlite-row.ts";
import { getWorkspaceAgentManagementView } from "./workspace-agent-management.ts";
import { instanceSessionState } from "./instance-session.ts";
import { assertNoUnresolvedRuntimeCleanup } from "./runtime-process-cleanup.ts";
import { canonicalDigest } from "./canonical-digest.ts";
import { roleRuntimeOffer } from "./role-runtime-offer.ts";

export function forkSourceIdentity(
  db: DatabaseSync,
  actorId: string,
  instanceId: string,
) {
  const row = db
    .prepare(
      `SELECT i.*,r.snapshot_json FROM role_instances i
    JOIN role_revisions r ON r.role_revision_id=i.role_revision_id WHERE i.instance_id=?`,
    )
    .get(instanceId);
  if (!row) throw new NotFoundError("Role instance not found");
  const role = RoleTemplateSchema.parse(JSON.parse(text(row, "snapshot_json")));
  const channelId = text(row, "channel_id");
  requireHumanControlRoomManager(db, role.controlRoomId, actorId);
  requireRoomManager(db, channelId, actorId);
  return { role, channelId, agentId: text(row, "agent_id") };
}

/** Recomputed on both sides of asynchronous native copying; never a session snapshot from a client. */
export function readForkSource(
  db: DatabaseSync,
  actorId: string,
  instanceId: string,
  seq: number,
  now: Date,
) {
  const identity = forkSourceIdentity(db, actorId, instanceId);
  const room = db
    .prepare("SELECT * FROM rooms WHERE room_id=?")
    .get(identity.channelId)!;
  if (
    room.archived_at != null ||
    !db
      .prepare("SELECT 1 FROM memberships WHERE room_id=? AND principal_id=?")
      .get(identity.channelId, instanceId)
  )
    throw new ConflictError(
      "Fork requires an active Channel member; source was removed or archived",
    );
  const latest = integer(room, "next_seq") - 1;
  if (seq !== latest) throw new StaleContextError(seq, latest);
  if (
    db
      .prepare(
        `SELECT 1 FROM run_attempts WHERE participant_id=? AND state IN ('starting','running','orphaned')
    UNION ALL SELECT 1 FROM runtime_processes WHERE participant_id=? AND state IN ('prepared','active','orphaned')
    UNION ALL SELECT 1 FROM activations WHERE participant_id=? AND state='leased'
    UNION ALL SELECT 1 FROM placements WHERE participant_id=? AND state='reserved' LIMIT 1`,
      )
      .get(instanceId, instanceId, instanceId, instanceId)
  )
    throw new ConflictError(
      "Fork requires idle source; wait for running or leased work",
    );
  assertNoUnresolvedRuntimeCleanup(db, instanceId);
  const session = instanceSessionState(db, instanceId);
  if (!session.required)
    throw new ConflictError("Fork requires an established native session");
  const view = getWorkspaceAgentManagementView(db, actorId, identity.agentId);
  if (view.agent.definition.state !== "enabled")
    throw new ConflictError("Fork source is not enabled");
  const revision = view.agent.currentRevision;
  const offerId = view.policy.required.allowedOfferIds?.[0];
  if (!offerId || view.policy.required.allowedOfferIds?.length !== 1)
    throw new ConflictError("Fork requires one pinned runtime");
  const offer = roleRuntimeOffer(db, offerId, now.getTime());
  const configuration = {
    ...identity.role.configuration,
    displayName: identity.role.configuration.displayName,
    instructions:
      revision.instructions ?? identity.role.configuration.instructions,
    role: revision.role,
    ...(revision.description === undefined
      ? {}
      : { description: revision.description }),
    ...(revision.avatarKey === undefined
      ? {}
      : { avatarKey: revision.avatarKey }),
    ...(revision.executionWorkspace === undefined
      ? {}
      : { executionWorkspace: revision.executionWorkspace }),
    modelIntent: view.policy.modelIntent,
    ...(view.policy.toolAccessMode === undefined
      ? {}
      : { toolAccessMode: view.policy.toolAccessMode }),
    runtimeOfferId: offer.runtimeOfferId,
  };
  const runHistory = db
    .prepare(
      "SELECT count(*) AS total,max(run_attempt_id) AS latest FROM run_attempts WHERE participant_id=?",
    )
    .get(instanceId);
  const placement = db
    .prepare(
      "SELECT p.host_id,p.runtime_profile_revision_id,p.workspace_mount_revision_id FROM placements p JOIN run_attempts r ON r.placement_id=p.placement_id WHERE p.participant_id=? ORDER BY r.started_at DESC,r.run_attempt_id DESC LIMIT 1",
    )
    .get(instanceId);
  const nativePlacement = placement
    ? {
        hostId: text(placement, "host_id"),
        runtimeProfileRevisionId: text(
          placement,
          "runtime_profile_revision_id",
        ),
        workspaceMountRevisionId: text(
          placement,
          "workspace_mount_revision_id",
        ),
      }
    : undefined;
  const fingerprint = canonicalDigest({
    identity,
    revision,
    policy: view.policy,
    session,
    runHistory,
    nativePlacement,
  });
  return {
    ...identity,
    configuration,
    nativePlacement,
    sourceGeneration: session.generation,
    fingerprint,
    hostId: offer.hostId,
    runtimeProfileId: offer.runtimeProfileId,
    runtimeProfileRevisionId: offer.runtimeProfileRevisionId,
  };
}
