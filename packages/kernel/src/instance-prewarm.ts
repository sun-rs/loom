import type { DatabaseSync } from "node:sqlite";

import {
  PlacementDecisionSchema,
  type AgentDefinitionRevision,
  type AgentRuntimeContext,
  type ContextManifest,
  type ExecutionPolicyRevision,
  type PlacementDecision,
  type RoomEvent,
} from "@rah-os/protocol";

import type { AuthenticatedHostContext } from "./auth.ts";
import { capacityProfileResourceId } from "./capacity-policy.ts";
import { createContextManifest } from "./context-manifest.ts";
import {
  planNextPlacement,
  type PlacementPlannerInput,
} from "./placement-planner.ts";
import { authorizedHostParticipantIds } from "./host-authorization.ts";
import {
  readAgentDefinitionRevision,
  readExecutionPolicyRevision,
} from "./placement-candidate-projection.ts";
import { agentRuntimeContextFromPlacement } from "./run-agent-context.ts";
import type { RuntimeTrajectoryServiceOptions } from "./runtime-trajectory.ts";
import { integer, text } from "./sqlite-row.ts";

/**
 * Owner 2026-09-27 (contract §6a): a Role instance's warm runtime is started
 * when the instance is created and, after a daemon start, for recently active
 * instances. The Kernel never starts a process. It records a content-free
 * Host hint in the Outbox inside the mutation's own transaction, and answers
 * a read-only plan: the placement, agent context and session generation the
 * instance's next turn would get now, so the Host launches exactly what that
 * turn reuses. A lost hint only means the first turn starts cold.
 */
export const INSTANCE_RUNTIME_HINT_TOPIC = "instance.runtime";

export type InstanceRuntimeHint = {
  action: "prewarm" | "retire";
  channelId: string;
  participantId: string;
};

/** The Host hint an accepted Room event implies, if any. */
export function instanceRuntimeHint(
  database: DatabaseSync,
  event: RoomEvent,
): InstanceRuntimeHint | undefined {
  if (event.type === "instance.created") {
    const instance = event.payload.instance as
      { instanceId?: unknown } | undefined;
    return typeof instance?.instanceId === "string"
      ? {
          action: "prewarm",
          channelId: event.roomId,
          participantId: instance.instanceId,
        }
      : undefined;
  }
  if (
    event.type === "membership.removed" &&
    typeof event.payload.participantId === "string" &&
    database
      .prepare(
        "SELECT 1 FROM role_instances WHERE instance_id = ? AND channel_id = ?",
      )
      .get(event.payload.participantId, event.roomId) !== undefined
  )
    return {
      action: "retire",
      channelId: event.roomId,
      participantId: event.payload.participantId,
    };
  return undefined;
}

/** The run caps a prewarm is admitted against, and what is reserved now. */
export type InstancePrewarmLimits = {
  hostMaxConcurrent: number;
  runtimeProfileMaxConcurrent: number;
  /** Placements reserved now on the Host / this RuntimeProfile. */
  hostReserved: number;
  runtimeProfileReserved: number;
};

export type InstancePrewarmPlan =
  | {
      kind: "ready";
      /** Synthetic ids: nothing durable carries them (no Activation, no run). */
      activationId: string;
      runAttemptId: string;
      roomId: string;
      fromSeq: number;
      toSeq: number;
      agent: AgentRuntimeContext;
      contextManifest: ContextManifest;
      placement: PlacementDecision;
      /** The run caps the placement was checked against. */
      limits: InstancePrewarmLimits;
    }
  | { kind: "skipped"; reason: string };

/**
 * Host-authenticated, read-only prewarm reads of the RoomKernel
 * (`kernel.instancePrewarm`). Nothing is reserved or written; the Host starts
 * the runtime and the instance's first turn is placed normally.
 */
export class InstancePrewarmService {
  readonly #options: RuntimeTrajectoryServiceOptions;
  readonly #plannerInput: (now: Date) => PlacementPlannerInput;

  constructor(
    options: RuntimeTrajectoryServiceOptions,
    plannerInput: (now: Date) => PlacementPlannerInput,
  ) {
    this.#options = options;
    this.#plannerInput = plannerInput;
  }

  /** The placement, agent context and manifest the next turn would get. */
  plan(
    host: AuthenticatedHostContext,
    input: { participantId: string },
  ): InstancePrewarmPlan {
    const authenticated = this.#options.requireHost(host);
    this.#options.requireHostParticipant(authenticated, input.participantId);
    const now = this.#options.now();
    const database = this.#options.database;
    return planInstancePrewarm({
      createId: this.#options.createId,
      database,
      host: authenticated,
      now,
      participantId: input.participantId,
      plannerInput: this.#plannerInput(now),
      readAgentRevision: (id) => readAgentDefinitionRevision(database, id),
      readExecutionPolicy: (id) => readExecutionPolicyRevision(database, id),
    });
  }

  /**
   * Review of the review-2 fixes P2-1: the current caps and reserved
   * placements for a planned offer, read again by the Host right before it
   * spawns a prewarm (the plan's copy may be stale by then). Undefined when
   * the offer is no longer published.
   */
  limits(
    host: AuthenticatedHostContext,
    input: { runtimeOfferId: string },
  ): InstancePrewarmLimits | undefined {
    this.#options.requireHost(host);
    return prewarmLimits(
      this.#plannerInput(this.#options.now()),
      input.runtimeOfferId,
    );
  }

  /** This Host's Role instances with a RunAttempt since `since` (ISO). */
  recentlyActive(
    host: AuthenticatedHostContext,
    input: { since: string },
  ): string[] {
    const authenticated = this.#options.requireHost(host);
    const database = this.#options.database;
    return recentlyActiveInstances(
      database,
      authorizedHostParticipantIds(database, authenticated),
      new Date(input.since).toISOString(),
    );
  }
}

/**
 * Read-only. The caller authenticated the Host and passes the scheduler's
 * projected planner input; the
 * instance's own candidate replaces the queued ones, so the capacity, lane,
 * offer, workspace and model rules are exactly the scheduler's.
 */
export function planInstancePrewarm(input: {
  database: DatabaseSync;
  host: { hostId: string; instanceId: string };
  participantId: string;
  now: Date;
  createId: (prefix: string) => string;
  plannerInput: PlacementPlannerInput;
  readAgentRevision(id: string): AgentDefinitionRevision;
  readExecutionPolicy(id: string): ExecutionPolicyRevision;
}): InstancePrewarmPlan {
  const { database, participantId } = input;
  const instance = database
    .prepare(
      `SELECT ri.channel_id, ad.state AS agent_state,
              ad.current_revision_id AS revision_id, r.next_seq
         FROM role_instances ri
         JOIN agent_definitions ad ON ad.participant_id = ri.instance_id
         JOIN rooms r ON r.room_id = ri.channel_id
         JOIN memberships m
           ON m.room_id = ri.channel_id AND m.principal_id = ri.instance_id
        WHERE ri.instance_id = ? AND r.archived_at IS NULL`,
    )
    .get(participantId);
  if (instance === undefined)
    return { kind: "skipped", reason: "instance_inactive" };
  const roomId = text(instance, "channel_id");
  const revision = input.readAgentRevision(text(instance, "revision_id"));
  const nowIso = input.now.toISOString();
  const activationId = input.createId("prewarm");
  const planned = planNextPlacement({
    ...input.plannerInput,
    candidates: [
      {
        activationId,
        agentDefinitionRevisionId: revision.agentDefinitionRevisionId,
        agentEnabled: text(instance, "agent_state") === "enabled",
        availableAt: nowIso,
        createdAt: nowIso,
        ...(revision.executionWorkspace === undefined
          ? {}
          : { executionWorkspace: revision.executionWorkspace }),
        executionPolicy: input.readExecutionPolicy(
          revision.executionPolicyRevisionId,
        ),
        participantId,
        priority: 0,
        roomId,
        workspaceDefinitionId: workspaceDefinitionIdOf(input.plannerInput),
      },
    ],
  });
  const selection = planned.selection;
  if (selection === undefined)
    return {
      kind: "skipped",
      reason: `placement_hold:${planned.holds[0]?.reason ?? "unplaced"}`,
    };
  if (
    selection.hostId !== input.host.hostId ||
    selection.hostInstanceId !== input.host.instanceId
  )
    return { kind: "skipped", reason: "placed_on_another_host" };
  const leaseUntil = new Date(input.now.getTime() + 1).toISOString();
  const placement = PlacementDecisionSchema.parse({
    ...selection,
    createdAt: nowIso,
    leaseUntil,
    placementId: activationId,
    state: "reserved",
  });
  const agent = agentRuntimeContextFromPlacement(database, {
    agent_definition_revision_id: placement.agentDefinitionRevisionId,
    participant_id: participantId,
  });
  const toSeq = Math.max(1, integer(instance, "next_seq") - 1);
  const runAttemptId = input.createId("prewarm_run");
  const contextManifest = createContextManifest({
    activation: {
      activationId,
      fromSeq: toSeq,
      participantId,
      roomId,
      toSeq,
    },
    agentContext: agent,
    contextManifestId: input.createId("prewarm_context"),
    createdAt: nowIso,
    placement,
    runAttemptId,
  });
  return {
    activationId,
    agent,
    contextManifest,
    fromSeq: toSeq,
    kind: "ready",
    limits: prewarmLimits(input.plannerInput, placement.runtimeOfferId)!,
    placement,
    roomId,
    runAttemptId,
    toSeq,
  };
}

/** The offer's Host and RuntimeProfile caps and reservations, now. */
function prewarmLimits(
  plannerInput: PlacementPlannerInput,
  runtimeOfferId: string,
): InstancePrewarmLimits | undefined {
  const capacities = plannerInput.capacities;
  const offer = plannerInput.offers.find(
    (candidate) => candidate.runtimeOfferId === runtimeOfferId,
  );
  if (offer === undefined) return undefined;
  const profileKey = capacityProfileResourceId(
    offer.hostId,
    offer.runtimeProfileId,
  );
  const hostCapacity = capacities.hosts.find(
    (host) => host.hostId === offer.hostId,
  );
  const profileCapacity = capacities.profiles.find(
    (profile) =>
      capacityProfileResourceId(profile.hostId, profile.runtimeProfileId) ===
      profileKey,
  );
  return {
    hostMaxConcurrent: hostCapacity?.adminMaxConcurrent ?? 1,
    hostReserved: hostCapacity?.reserved ?? 0,
    runtimeProfileMaxConcurrent: profileCapacity?.adminMaxConcurrent ?? 1,
    runtimeProfileReserved: profileCapacity?.reserved ?? 0,
  };
}

/** The scheduler's single workspace definition (see the planner projection). */
function workspaceDefinitionIdOf(input: PlacementPlannerInput): string {
  const ids = [
    ...new Set(
      input.offers.flatMap((offer) =>
        offer.workspaceMountDescriptors.map(
          (workspace) => workspace.workspaceDefinitionId,
        ),
      ),
    ),
  ];
  return ids.length === 1 ? ids[0]! : "workspace-unconfigured";
}

/**
 * Role instances the Host serves that are still members of their Channel and
 * started a RunAttempt at or after `since` (daemon-start prewarm).
 */
export function recentlyActiveInstances(
  database: DatabaseSync,
  participantIds: readonly string[],
  since: string,
): string[] {
  if (participantIds.length === 0) return [];
  const authorized = new Set(participantIds);
  return database
    .prepare(
      `SELECT ri.instance_id, MAX(ra.started_at) AS last_started
         FROM role_instances ri
         JOIN memberships m
           ON m.room_id = ri.channel_id AND m.principal_id = ri.instance_id
         JOIN rooms r ON r.room_id = ri.channel_id AND r.archived_at IS NULL
         JOIN run_attempts ra ON ra.participant_id = ri.instance_id
        WHERE ra.started_at >= ?
        GROUP BY ri.instance_id
        ORDER BY last_started DESC, ri.instance_id`,
    )
    .all(since)
    .map((row) => text(row, "instance_id"))
    .filter((id) => authorized.has(id));
}
