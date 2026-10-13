import type { DatabaseSync } from "node:sqlite";
import * as P from "@rah-os/protocol";
import {
  requireAuthenticatedHost,
  type AuthenticatedHostContext,
  type AuthenticatedActorContext,
} from "./auth.ts";
import { authorizedHostParticipantIds } from "./host-authorization.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { canonicalDigest } from "./canonical-digest.ts";
import { forkSourceIdentity, readForkSource } from "./instance-fork-source.ts";
import { ConflictError, IdempotencyConflictError } from "./errors.ts";
import {
  provisionWorkspaceAgentTransaction,
  workspaceAgentProvisionResult,
} from "./workspace-agent-provisioning.ts";
import { allocateInstanceName } from "./role-names.ts";
import { integer } from "./sqlite-row.ts";

type Context = {
  database: DatabaseSync;
  events: RoomEventWriter;
  now(): Date;
  createId(prefix: string): string;
  requireActor(actor: AuthenticatedActorContext): string;
  transaction<T>(operation: () => T): T;
};
export type InstanceForkPlan = ReturnType<typeof readForkSource> & {
  sourceInstanceId: string;
  targetInstanceId: string;
  operationId: string;
};
/** Trusted in-process Host port: resolve only after an independent native binding is durable.
 * This callback is never a client-supplied native session ID or Worker capability.
 */
export type CopyInstanceSession = (
  plan: Readonly<InstanceForkPlan>,
) => Promise<void>;

export async function forkInstance(
  c: Context,
  auth: AuthenticatedActorContext,
  host: AuthenticatedHostContext,
  raw: P.InstanceForkRequest,
  copy: CopyInstanceSession,
  side = false,
): Promise<P.RoleInstantiateResponse> {
  const input = P.InstanceForkRequestSchema.parse(raw);
  const actorId = c.requireActor(auth);
  const requestDigest = canonicalDigest(input);
  const operationId = canonicalDigest({
    actorId,
    ...(side ? { kind: "side" } : {}),
    instanceId: input.instanceId,
    key: input.idempotencyKey,
  });
  const targetInstanceId = `principal_${side ? "side" : "fork"}_${operationId.slice(7)}`;
  const sideRoomId = `room_side_${operationId.slice(7)}`;
  const replay = () => {
    const { channelId } = forkSourceIdentity(
      c.database,
      c.requireActor(auth),
      input.instanceId,
    );
    const row = c.database
      .prepare(
        "SELECT * FROM room_events WHERE room_id=? AND idempotency_key=?",
      )
      .get(side ? sideRoomId : channelId, input.idempotencyKey);
    if (!row) return;
    const event = c.events.eventFromRow(row);
    if (
      event.actorId !== actorId ||
      event.type !== (side ? "side.created" : "instance.created") ||
      event.payload.sourceInstanceId !== input.instanceId ||
      event.payload.requestDigest !== requestDigest
    )
      throw new IdempotencyConflictError("Fork command key already used");
    const provision = c.database
      .prepare("SELECT * FROM room_events WHERE event_id=?")
      .get(String(event.payload.provisionEventId));
    if (!provision)
      throw new ConflictError("Fork provisioning receipt missing");
    return P.RoleInstantiateResponseSchema.parse({
      instance: event.payload.instance,
      agent: workspaceAgentProvisionResult(
        c.database,
        c.events.eventFromRow(provision),
        true,
      ).agent,
      event,
      deduplicated: true,
    });
  };
  const requireCopyHost = () => {
    const current = requireAuthenticatedHost(c.database, host);
    if (
      !authorizedHostParticipantIds(c.database, current).includes(
        input.instanceId,
      )
    )
      throw new ConflictError(
        "Fork Host is not authorized for source instance",
      );
  };
  const initial = c.transaction(() => {
    const prior = replay();
    if (prior) return { prior };
    requireCopyHost();
    return {
      source: readForkSource(
        c.database,
        actorId,
        input.instanceId,
        input.basedOnRoomSeq,
        c.now(),
      ),
    };
  });
  if (initial.prior) return initial.prior;
  const source = initial.source!;
  if (source.hostId !== host.hostId)
    throw new ConflictError("Fork Host does not own source runtime");
  await copy({
    ...source,
    sourceInstanceId: input.instanceId,
    targetInstanceId,
    operationId,
  });
  return c.transaction(() => {
    const prior = replay();
    if (prior) return prior;
    requireCopyHost();
    const current = readForkSource(
      c.database,
      c.requireActor(auth),
      input.instanceId,
      input.basedOnRoomSeq,
      c.now(),
    );
    if (
      current.fingerprint !== source.fingerprint ||
      current.runtimeProfileRevisionId !== source.runtimeProfileRevisionId
    )
      throw new ConflictError(
        "Fork source changed during native copying; copied session was not published",
      );
    const targetRoomId = side ? sideRoomId : source.channelId;
    const name = allocateInstanceName(
      c.database,
      source.role.configuration.displayName + (side ? "-side" : ""),
    );
    if (side) {
      const workspaceId = c.database
        .prepare("SELECT workspace_id FROM rooms WHERE room_id=?")
        .get(source.channelId)!.workspace_id;
      c.database
        .prepare(
          "INSERT INTO rooms(room_id,workspace_id,kind,slug,name,next_seq,created_at) VALUES(?,?,'direct',?,?,1,?)",
        )
        .run(
          targetRoomId,
          workspaceId!,
          `dm-${targetRoomId}`,
          name,
          c.now().toISOString(),
        );
    }
    const {
      avatarKey,
      description,
      executionWorkspace,
      toolAccessMode,
      sessionPolicy,
      ...configuration
    } = current.configuration;
    const created = provisionWorkspaceAgentTransaction(
      {
        ...c,
        actorId,
        createId: (prefix) =>
          prefix === "principal" ? targetInstanceId : c.createId(prefix),
        roleInstance: {
          roleId: source.role.roleId,
          roleRevisionId: source.role.roleRevisionId,
          channelId: targetRoomId,
        },
      },
      {
        ...configuration,
        ...(side
          ? {
              instructions: `${configuration.instructions}\n\nSide conversation: independent private dialogue. Source Channel ${source.channelId} is read-only via message history (--channel ${source.channelId}); reply only in this conversation. No Task, membership or memory mutations.`,
            }
          : {}),
        ...(avatarKey === undefined ? {} : { avatarKey }),
        ...(description === undefined ? {} : { description }),
        ...(executionWorkspace === undefined ? {} : { executionWorkspace }),
        ...(toolAccessMode === undefined ? {} : { toolAccessMode }),
        ...(sessionPolicy === undefined ? {} : { sessionPolicy }),
        handle: name,
        displayName: name,
        controlRoomId: source.role.controlRoomId,
        basedOnRoomSeq:
          integer(
            c.database
              .prepare("SELECT next_seq FROM rooms WHERE room_id=?")
              .get(source.role.controlRoomId)!,
            "next_seq",
          ) - 1,
        idempotencyKey: `fork-provision:${operationId.slice(7)}`,
      },
    );
    const instance = {
      instanceId: targetInstanceId,
      agentId: created.agent.definition.agentId,
      roleId: source.role.roleId,
      roleRevisionId: source.role.roleRevisionId,
      channelId: targetRoomId,
    };
    const now = c.now().toISOString();
    c.database
      .prepare(
        "INSERT INTO memberships(room_id,principal_id,role,joined_at) VALUES(?,?,'member',?)",
      )
      .run(targetRoomId, targetInstanceId, now);
    c.events.append({
      actorId,
      aggregateId: targetInstanceId,
      aggregateType: "membership",
      roomId: targetRoomId,
      idempotencyKey: `${input.idempotencyKey}:membership`,
      type: "membership.added",
      payload: { participantId: targetInstanceId, role: "member" },
    });
    if (side) {
      c.database
        .prepare(
          "INSERT INTO memberships(room_id,principal_id,role,joined_at) VALUES(?,?,'owner',?)",
        )
        .run(targetRoomId, actorId, now);
      const workspaceId = c.database
        .prepare("SELECT workspace_id FROM rooms WHERE room_id=?")
        .get(targetRoomId)!.workspace_id;
      const pair = [actorId, targetInstanceId].sort((a, b) =>
        a.localeCompare(b),
      );
      c.database
        .prepare(
          "INSERT INTO direct_room_pairs(workspace_id,left_principal_id,right_principal_id,room_id) VALUES(?,?,?,?)",
        )
        .run(workspaceId!, pair[0]!, pair[1]!, targetRoomId);
      c.database
        .prepare(
          "INSERT INTO side_sessions(instance_id,room_id,source_instance_id,source_channel_id,owner_id) VALUES(?,?,?,?,?)",
        )
        .run(
          targetInstanceId,
          targetRoomId,
          input.instanceId,
          source.channelId,
          actorId,
        );
    }
    // Explicit copy evidence, not a fabricated RunAttempt or source consumption receipt.
    c.database
      .prepare(
        "INSERT INTO role_instance_sessions(instance_id,generation,bound,bound_at,updated_at) VALUES(?,0,1,?,?)",
      )
      .run(targetInstanceId, now, now);
    const event = c.events.append({
      actorId,
      aggregateId: targetInstanceId,
      aggregateType: "instance",
      roomId: targetRoomId,
      idempotencyKey: input.idempotencyKey,
      type: side ? "side.created" : "instance.created",
      payload: {
        instance,
        sourceInstanceId: input.instanceId,
        sourceGeneration: source.sourceGeneration,
        sourceFingerprint: source.fingerprint,
        operationId,
        provisionEventId: created.event.eventId,
        requestDigest,
      },
    });
    return P.RoleInstantiateResponseSchema.parse({
      instance,
      agent: created.agent,
      event,
      deduplicated: false,
    });
  });
}
