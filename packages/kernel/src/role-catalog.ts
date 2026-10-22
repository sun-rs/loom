import { discardSide, reconcileSideDiscards } from "./side-lifecycle.ts";
import { sideProjection } from "./side-session.ts";
import { forkInstance, type CopyInstanceSession } from "./instance-fork.ts";
import { adoptInstanceRoleRevision } from "./instance-restart-config.ts";
import { assertNoUnresolvedRuntimeCleanup } from "./runtime-process-cleanup.ts";
import type { DatabaseSync } from "node:sqlite";
import * as P from "@rah-os/protocol";
import type {
  AuthenticatedActorContext,
  AuthenticatedHostContext,
} from "./auth.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import {
  requireHumanControlRoomManager,
  requireRoomManager,
} from "./collaboration-policy.ts";
import { assertRoleNameAvailable, allocateInstanceName } from "./role-names.ts";
import { canonicalDigest } from "./canonical-digest.ts";
import { text, integer, type Row } from "./sqlite-row.ts";
import {
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  NotFoundError,
  StaleContextError,
} from "./errors.ts";
import { advanceInstanceSessionGeneration } from "./instance-session.ts";
import { abandonBlockedActivation } from "./blocked-activation-abandon.ts";
import { observedCompactionCount } from "./runtime-trajectory.ts";
import {
  resumeBlockedActivationRetryFences,
  SESSION_CONTINUITY_FAILURE_MARKER,
} from "./activation-retry-fence.ts";
import {
  provisionWorkspaceAgentTransaction,
  workspaceAgentProvisionResult,
} from "./workspace-agent-provisioning.ts";

type Context = {
  database: DatabaseSync;
  events: RoomEventWriter;
  now(): Date;
  createId(prefix: string): string;
  requireActor(actor: AuthenticatedActorContext): string;
  transaction<T>(operation: () => T): T;
};
/** First vertical Role path. Reuses provisioning and Room delivery, not a new scheduler. */
export class RoleCatalog {
  private readonly context: Context;
  constructor(context: Context) {
    this.context = context;
  }
  forkInstance(
    auth: AuthenticatedActorContext,
    host: AuthenticatedHostContext,
    input: P.InstanceForkRequest,
    copy: CopyInstanceSession,
  ) {
    return forkInstance(this.context, auth, host, input, copy);
  }
  async createSide(
    auth: AuthenticatedActorContext,
    host: AuthenticatedHostContext,
    input: P.InstanceForkRequest,
    copy: CopyInstanceSession,
  ): Promise<P.SideCreateResponse> {
    const result = await forkInstance(
      this.context,
      auth,
      host,
      input,
      copy,
      true,
    );
    return P.SideCreateResponseSchema.parse({
      side: sideProjection(this.context.database, result.instance.instanceId),
      agent: result.agent,
      event: result.event,
      deduplicated: result.deduplicated,
    });
  }
  discardSide(auth: AuthenticatedActorContext, input: P.SideDiscardRequest) {
    return discardSide(this.context, auth, input);
  }
  reconcileSideDiscards() {
    return reconcileSideDiscards(this.context);
  }
  private role(row: Row) {
    const snapshot = this.context.database
      .prepare(
        "SELECT snapshot_json FROM role_revisions WHERE role_revision_id=?",
      )
      .get(text(row, "role_revision_id"));
    const updatedAt = snapshot
      ? JSON.parse(text(snapshot, "snapshot_json")).updatedAt
      : undefined;
    return P.RoleTemplateSchema.parse({
      roleId: text(row, "role_id"),
      roleRevisionId: text(row, "role_revision_id"),
      controlRoomId: text(row, "control_room_id"),
      configuration: JSON.parse(text(row, "configuration_json")),
      createdAt: text(row, "created_at"),
      ...(updatedAt ? { updatedAt } : {}),
    });
  }
  private requireRole(id: string) {
    const row = this.context.database
      .prepare("SELECT * FROM role_templates WHERE role_id=?")
      .get(id);
    if (!row) throw new NotFoundError("Role not found");
    return this.role(row);
  }
  private requireActive(id: string) {
    if (
      this.context.database
        .prepare("SELECT deleted_at FROM role_templates WHERE role_id=?")
        .get(id)?.deleted_at != null
    )
      throw new ConflictError("Role has been deleted");
  }
  delete(auth: AuthenticatedActorContext, raw: P.RoleDeleteRequest) {
    const input = P.RoleDeleteRequestSchema.parse(raw),
      c = this.context;
    return c.transaction(() => {
      const actorId = c.requireActor(auth),
        role = this.requireRole(input.roleId);
      requireHumanControlRoomManager(c.database, role.controlRoomId, actorId);
      const requestDigest = canonicalDigest(input);
      const prior = this.replay(
        actorId,
        role.controlRoomId,
        input.idempotencyKey,
        "role.deleted",
        requestDigest,
      );
      if (prior)
        return { roleId: role.roleId, event: prior, deduplicated: true };
      this.requireActive(role.roleId);
      if (role.roleRevisionId !== input.expectedRoleRevisionId)
        throw new ConflictError(
          "Role revision changed; reload before deleting",
        );
      this.fresh(role.controlRoomId, input.basedOnRoomSeq);
      c.database
        .prepare("UPDATE role_templates SET deleted_at=? WHERE role_id=?")
        .run(c.now().toISOString(), role.roleId);
      const event = c.events.append({
        actorId,
        aggregateId: role.roleId,
        aggregateType: "role",
        roomId: role.controlRoomId,
        idempotencyKey: input.idempotencyKey,
        type: "role.deleted",
        payload: { roleId: role.roleId, requestDigest },
      });
      return { roleId: role.roleId, event, deduplicated: false };
    });
  }
  private snapshot(revisionId: string) {
    const row = this.context.database
      .prepare(
        "SELECT snapshot_json FROM role_revisions WHERE role_revision_id=?",
      )
      .get(revisionId);
    if (!row) throw new NotFoundError("Role revision not found");
    return P.RoleTemplateSchema.parse(JSON.parse(text(row, "snapshot_json")));
  }
  private saveSnapshot(role: P.RoleTemplate) {
    this.context.database
      .prepare("INSERT INTO role_revisions VALUES(?,?,?)")
      .run(role.roleRevisionId, role.roleId, JSON.stringify(role));
  }
  revise(auth: AuthenticatedActorContext, raw: P.RoleReviseRequest) {
    const input = P.RoleReviseRequestSchema.parse(raw),
      c = this.context;
    return c.transaction(() => {
      const actorId = c.requireActor(auth),
        current = this.requireRole(input.roleId);
      requireHumanControlRoomManager(
        c.database,
        current.controlRoomId,
        actorId,
      );
      const requestDigest = canonicalDigest(input);
      const prior = this.replay(
        actorId,
        current.controlRoomId,
        input.idempotencyKey,
        "role.revised",
        requestDigest,
      );
      if (prior)
        return {
          role: this.snapshot(String(prior.payload.roleRevisionId)),
          event: prior,
          deduplicated: true,
        };
      this.requireActive(current.roleId);
      if (current.roleRevisionId !== input.expectedRoleRevisionId)
        throw new ConflictError("Role revision changed; reload before editing");
      this.fresh(current.controlRoomId, input.basedOnRoomSeq);
      assertRoleNameAvailable(
        c.database,
        current.controlRoomId,
        input.configuration.displayName,
        current.roleId,
      );
      const role = P.RoleTemplateSchema.parse({
        ...current,
        configuration: input.configuration,
        updatedAt: c.now().toISOString(),
        roleRevisionId: c.createId("role_revision"),
      });
      this.saveSnapshot(role);
      c.database
        .prepare(
          "UPDATE role_templates SET role_revision_id=?,configuration_json=? WHERE role_id=?",
        )
        .run(
          role.roleRevisionId,
          JSON.stringify(role.configuration),
          role.roleId,
        );
      const event = c.events.append({
        actorId,
        aggregateId: role.roleId,
        aggregateType: "role",
        roomId: role.controlRoomId,
        idempotencyKey: input.idempotencyKey,
        type: "role.revised",
        payload: {
          roleId: role.roleId,
          roleRevisionId: role.roleRevisionId,
          previousRoleRevisionId: current.roleRevisionId,
          requestDigest,
        },
      });
      return { role, event, deduplicated: false };
    });
  }
  list(auth: AuthenticatedActorContext, raw: { controlRoomId: string }) {
    const { controlRoomId } = P.RoleListRequestSchema.parse(raw);
    requireHumanControlRoomManager(
      this.context.database,
      controlRoomId,
      this.context.requireActor(auth),
    );
    return {
      instances: this.context.database
        .prepare(
          `SELECT i.*,t.role_revision_id AS current_revision_id FROM role_instances i
        JOIN role_templates t ON t.role_id=i.role_id
        JOIN memberships m ON m.room_id=i.channel_id AND m.principal_id=i.instance_id
        WHERE t.control_room_id=? AND NOT EXISTS (SELECT 1 FROM side_sessions s WHERE s.instance_id=i.instance_id) ORDER BY i.instance_id`,
        )
        .all(controlRoomId)
        .map((row) => ({
          instanceId: text(row, "instance_id"),
          agentId: text(row, "agent_id"),
          roleId: text(row, "role_id"),
          roleRevisionId: text(row, "role_revision_id"),
          channelId: text(row, "channel_id"),
          isCurrent: row.role_revision_id === row.current_revision_id,
          sessionCompactionCount: this.sessionCompactionCount(
            text(row, "instance_id"),
          ),
        })),
      roles: this.context.database
        .prepare(
          "SELECT * FROM role_templates WHERE control_room_id=? AND deleted_at IS NULL ORDER BY created_at,role_id",
        )
        .all(controlRoomId)
        .map((row) => this.role(row)),
    };
  }
  /**
   * The current session starts at the instance's latest Human reset (a reset
   * refuses while a run is live, so no run straddles it).
   */
  private sessionCompactionCount(instanceId: string): number | null {
    return observedCompactionCount(this.context.database, {
      sql: `SELECT run_attempt_id FROM run_attempts WHERE participant_id=?
        AND started_at >= COALESCE((SELECT MAX(created_at) FROM room_events
          WHERE aggregate_type='instance' AND aggregate_id=?
            AND type='instance.session_reset'), '')`,
      parameters: [instanceId, instanceId],
    });
  }
  private replay(
    actorId: string,
    roomId: string,
    key: string,
    type: string,
    digest: string,
  ) {
    const row = this.context.database
      .prepare(
        "SELECT * FROM room_events WHERE room_id=? AND idempotency_key=?",
      )
      .get(roomId, key);
    if (!row) return undefined;
    const event = this.context.events.eventFromRow(row);
    if (
      event.actorId !== actorId ||
      event.type !== type ||
      event.payload.requestDigest !== digest
    )
      throw new IdempotencyConflictError("Role command key already used");
    return event;
  }
  private fresh(roomId: string, seq: number) {
    const room = this.context.database
      .prepare("SELECT next_seq FROM rooms WHERE room_id=?")
      .get(roomId);
    if (!room) throw new NotFoundError("Room not found");
    const latest = integer(room, "next_seq") - 1;
    if (seq !== latest) throw new StaleContextError(seq, latest);
  }
  create(auth: AuthenticatedActorContext, raw: P.RoleCreateRequest) {
    const input = P.RoleCreateRequestSchema.parse(raw),
      c = this.context;
    return c.transaction(() => {
      const actorId = c.requireActor(auth);
      requireHumanControlRoomManager(c.database, input.controlRoomId, actorId);
      const requestDigest = canonicalDigest(input);
      const prior = this.replay(
        actorId,
        input.controlRoomId,
        input.idempotencyKey,
        "role.created",
        requestDigest,
      );
      if (prior)
        return {
          role: this.snapshot(String(prior.payload.roleRevisionId)),
          event: prior,
          deduplicated: true,
        };
      this.fresh(input.controlRoomId, input.basedOnRoomSeq);
      assertRoleNameAvailable(
        c.database,
        input.controlRoomId,
        input.configuration.displayName,
      );
      const role = P.RoleTemplateSchema.parse({
        roleId: c.createId("role"),
        roleRevisionId: c.createId("role_revision"),
        controlRoomId: input.controlRoomId,
        configuration: input.configuration,
        createdAt: c.now().toISOString(),
      });
      c.database
        .prepare(
          "INSERT INTO role_templates(role_id,role_revision_id,control_room_id,configuration_json,created_at) VALUES(?,?,?,?,?)",
        )
        .run(
          role.roleId,
          role.roleRevisionId,
          role.controlRoomId,
          JSON.stringify(role.configuration),
          role.createdAt,
        );
      this.saveSnapshot(role);
      const event = c.events.append({
        actorId,
        aggregateId: role.roleId,
        aggregateType: "role",
        roomId: role.controlRoomId,
        idempotencyKey: input.idempotencyKey,
        type: "role.created",
        payload: {
          roleId: role.roleId,
          roleRevisionId: role.roleRevisionId,
          requestDigest,
        },
      });
      return { role, event, deduplicated: false };
    });
  }
  instantiate(auth: AuthenticatedActorContext, raw: P.RoleInstantiateRequest) {
    const input = P.RoleInstantiateRequestSchema.parse(raw),
      c = this.context;
    return c.transaction(() => {
      const actorId = c.requireActor(auth),
        role = this.requireRole(input.roleId);
      requireHumanControlRoomManager(c.database, role.controlRoomId, actorId);
      requireRoomManager(c.database, input.channelId, actorId);
      const channel = c.database
        .prepare(
          "SELECT r.* FROM rooms r JOIN rooms c ON c.workspace_id=r.workspace_id WHERE r.room_id=? AND c.room_id=? AND r.kind='channel' AND r.archived_at IS NULL",
        )
        .get(input.channelId, role.controlRoomId);
      if (!channel)
        throw new ForbiddenError(
          "Instance requires an active channel in the Role workspace",
        );
      const requestDigest = canonicalDigest(input);
      const prior = this.replay(
        actorId,
        input.channelId,
        input.idempotencyKey,
        "instance.created",
        requestDigest,
      );
      if (prior) {
        const provision = c.database
          .prepare("SELECT * FROM room_events WHERE event_id=?")
          .get(String(prior.payload.provisionEventId));
        if (!provision)
          throw new ConflictError("Instance provisioning receipt missing");
        const result = workspaceAgentProvisionResult(
          c.database,
          c.events.eventFromRow(provision),
          true,
        );
        return P.RoleInstantiateResponseSchema.parse({
          instance: prior.payload.instance,
          agent: result.agent,
          event: prior,
          deduplicated: true,
        });
      }
      this.requireActive(role.roleId);
      this.fresh(input.channelId, input.basedOnRoomSeq);
      const suffix = c
        .createId("instance")
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(-24);
      const instanceName = allocateInstanceName(
        c.database,
        role.configuration.displayName,
      );
      const control = c.database
        .prepare("SELECT next_seq FROM rooms WHERE room_id=?")
        .get(role.controlRoomId)!;
      const { avatarKey, description, toolAccessMode, ...configuration } =
        role.configuration;
      const created = provisionWorkspaceAgentTransaction(
        {
          ...c,
          actorId,
          roleInstance: {
            roleId: role.roleId,
            roleRevisionId: role.roleRevisionId,
            channelId: input.channelId,
          },
        },
        {
          ...configuration,
          ...(avatarKey === undefined ? {} : { avatarKey }),
          ...(description === undefined ? {} : { description }),
          ...(toolAccessMode === undefined ? {} : { toolAccessMode }),
          handle: instanceName,
          displayName: instanceName,
          controlRoomId: role.controlRoomId,
          basedOnRoomSeq: integer(control, "next_seq") - 1,
          idempotencyKey: `role-provision:${suffix}`,
        },
      );
      const instance = {
        instanceId: created.agent.definition.participantId,
        agentId: created.agent.definition.agentId,
        roleId: role.roleId,
        roleRevisionId: role.roleRevisionId,
        channelId: input.channelId,
      };
      c.database
        .prepare(
          "INSERT INTO memberships(room_id,principal_id,role,joined_at) VALUES(?,?,'member',?)",
        )
        .run(input.channelId, instance.instanceId, c.now().toISOString());
      c.events.append({
        actorId,
        aggregateId: instance.instanceId,
        aggregateType: "membership",
        roomId: input.channelId,
        idempotencyKey: `${input.idempotencyKey}:membership`,
        type: "membership.added",
        payload: { participantId: instance.instanceId, role: "member" },
      });
      const event = c.events.append({
        actorId,
        aggregateId: instance.instanceId,
        aggregateType: "instance",
        roomId: input.channelId,
        idempotencyKey: input.idempotencyKey,
        type: "instance.created",
        payload: {
          instance,
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

  /**
   * Human recovery exit (S1-f): the instance's next run starts a new native
   * session. Refused while the instance has a live run: a RunAttempt that is
   * starting/running or a runtime process that is prepared/active/orphaned.
   * A leased Activation without such a run is allowed, because the session
   * generation is read when its RunAttempt is created (the launch then uses
   * the new generation). The reset is recorded in the instance's channel; it
   * never deletes history. In the same transaction it requeues the
   * Activations quarantined by a session-continuity failure (the only fence a
   * new session clears) and records them as its recovery scope.
   */
  resetInstanceSession(
    auth: AuthenticatedActorContext,
    raw: P.InstanceSessionResetRequest,
  ) {
    const input = P.InstanceSessionResetRequestSchema.parse(raw),
      c = this.context;
    return c.transaction(() => {
      const actorId = c.requireActor(auth);
      const instance = c.database
        .prepare(
          "SELECT ri.channel_id, rt.control_room_id FROM role_instances ri JOIN role_templates rt ON rt.role_id=ri.role_id WHERE ri.instance_id=?",
        )
        .get(input.instanceId);
      if (!instance) throw new NotFoundError("Role instance not found");
      const channelId = text(instance, "channel_id");
      requireHumanControlRoomManager(
        c.database,
        text(instance, "control_room_id"),
        actorId,
      );
      requireRoomManager(c.database, channelId, actorId);
      const requestDigest = canonicalDigest({
        instanceId: input.instanceId,
        ...(input.adoptRoleRevisionId === undefined
          ? {}
          : { adoptRoleRevisionId: input.adoptRoleRevisionId }),
      });
      const prior = this.replay(
        actorId,
        channelId,
        input.idempotencyKey,
        "instance.session_reset",
        requestDigest,
      );
      if (prior)
        return P.InstanceSessionResetResponseSchema.parse({
          instanceId: input.instanceId,
          channelId,
          sessionGeneration: prior.payload.sessionGeneration,
          event: prior,
          deduplicated: true,
        });
      this.fresh(channelId, input.basedOnRoomSeq);
      const running = c.database
        .prepare(
          // A run computes its session generation when it starts; a leased
          // Activation without a live run still launches under the new one.
          `SELECT 1 FROM run_attempts WHERE participant_id=? AND state IN ('starting','running')
           UNION ALL SELECT 1 FROM runtime_processes WHERE participant_id=? AND state IN ('prepared','active','orphaned')
           LIMIT 1`,
        )
        .get(input.instanceId, input.instanceId);
      if (running)
        throw new ConflictError(
          "Role instance has running work; wait for it to finish before resetting its session",
        );
      assertNoUnresolvedRuntimeCleanup(c.database, input.instanceId);
      if (input.adoptRoleRevisionId !== undefined)
        adoptInstanceRoleRevision({ ...c, actorId }, input);
      const resetAt = c.now().toISOString();
      const sessionGeneration = advanceInstanceSessionGeneration(
        c.database,
        input.instanceId,
        resetAt,
      );
      // The obligations a lost session blocked run again in the new
      // generation, through the existing retry owner; any other quarantine
      // (auth, input size, zero evidence, ...) keeps holding the lane.
      const resumed = resumeBlockedActivationRetryFences(c.database, {
        errorMarker: SESSION_CONTINUITY_FAILURE_MARKER,
        participantId: input.instanceId,
        resumedAt: resetAt,
      });
      const event = c.events.append({
        actorId,
        aggregateId: input.instanceId,
        aggregateType: "instance",
        roomId: channelId,
        idempotencyKey: input.idempotencyKey,
        type: "instance.session_reset",
        payload: {
          instanceId: input.instanceId,
          notice: "context continuity interrupted by Human reset",
          historyRecovery: "bounded_current_room",
          ...(input.adoptRoleRevisionId === undefined
            ? {}
            : { roleRevisionId: input.adoptRoleRevisionId }),
          recovery: {
            resumedActivationIds: resumed.map((retry) => retry.activationId),
          },
          requestDigest,
          sessionGeneration,
        },
      });
      for (const retry of resumed)
        c.events.append({
          actorId,
          aggregateId: retry.activationId,
          aggregateType: "activation",
          idempotencyKey: `${input.idempotencyKey}:activation-retry-resume:${retry.activationId}`,
          payload: {
            activationId: retry.activationId,
            cause: "instance.session_reset",
            errorFingerprint: retry.errorFingerprint,
            ...(retry.mergedActivationId === undefined
              ? {}
              : { mergedActivationId: retry.mergedActivationId }),
            participantId: input.instanceId,
            sameErrorCount: retry.sameErrorCount,
            sessionGeneration,
          },
          roomId: retry.roomId,
          type: "activation.retry_resumed",
        });
      return P.InstanceSessionResetResponseSchema.parse({
        instanceId: input.instanceId,
        channelId,
        sessionGeneration,
        event,
        deduplicated: false,
      });
    });
  }

  /**
   * D2-2 Human recovery exit: abandon one Activation of this instance that a
   * blocked retry fence stopped (`blocked-activation-abandon.ts`), releasing
   * the lane. Recorded in the instance's channel; replay returns that event.
   */
  abandonBlockedActivation(
    auth: AuthenticatedActorContext,
    raw: P.InstanceActivationAbandonRequest,
  ) {
    const input = P.InstanceActivationAbandonRequestSchema.parse(raw),
      c = this.context;
    return c.transaction(() => {
      const actorId = c.requireActor(auth);
      const instance = c.database
        .prepare(
          "SELECT ri.channel_id, rt.control_room_id FROM role_instances ri JOIN role_templates rt ON rt.role_id=ri.role_id WHERE ri.instance_id=?",
        )
        .get(input.instanceId);
      if (!instance) throw new NotFoundError("Role instance not found");
      const channelId = text(instance, "channel_id");
      requireHumanControlRoomManager(
        c.database,
        text(instance, "control_room_id"),
        actorId,
      );
      requireRoomManager(c.database, channelId, actorId);
      const requestDigest = canonicalDigest({
        activationId: input.activationId,
        instanceId: input.instanceId,
      });
      const prior = this.replay(
        actorId,
        channelId,
        input.idempotencyKey,
        "instance.activation_abandoned",
        requestDigest,
      );
      if (prior)
        return P.InstanceActivationAbandonResponseSchema.parse({
          instanceId: input.instanceId,
          channelId,
          activationId: input.activationId,
          event: prior,
          deduplicated: true,
        });
      this.fresh(channelId, input.basedOnRoomSeq);
      const abandoned = abandonBlockedActivation({
        actorId,
        activationId: input.activationId,
        database: c.database,
        events: c.events,
        idempotencyKey: input.idempotencyKey,
        now: c.now().toISOString(),
        participantId: input.instanceId,
      });
      const event = c.events.append({
        actorId,
        aggregateId: input.instanceId,
        aggregateType: "instance",
        roomId: channelId,
        idempotencyKey: input.idempotencyKey,
        type: "instance.activation_abandoned",
        // Review P1-1: this lifecycle fact lands in the Channel, which the
        // instance's siblings read. Work blocked in another Room (the private
        // box) keeps its error and location in that Room's own cancellation.
        payload: {
          activationId: input.activationId,
          instanceId: input.instanceId,
          ...(abandoned.roomId === channelId
            ? {
                activationRoomId: abandoned.roomId,
                cancelledEventId: abandoned.event.eventId,
                ...(abandoned.lastError === null
                  ? {}
                  : { blockedError: abandoned.lastError.slice(0, 2_000) }),
              }
            : { elsewhere: true }),
          requestDigest,
        },
      });
      return P.InstanceActivationAbandonResponseSchema.parse({
        instanceId: input.instanceId,
        channelId,
        activationId: input.activationId,
        event,
        deduplicated: false,
      });
    });
  }
}
