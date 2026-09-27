import type { DatabaseSync } from "node:sqlite";
import type {
  AgentDefinitionRevision,
  ExecutionPolicyRevision,
  PlacementDecision,
  RuntimeOfferProjection,
} from "@rah-os/protocol";
import type { PlacementPlannerInput } from "./placement-planner.ts";
import type { InPlaceWorkspaceSharing } from "./room-kernel-options.ts";
import { text, type Row } from "./sqlite-row.ts";
import { capacityProfileResourceId } from "./capacity-policy.ts";
import { projectPlacementCandidates } from "./placement-candidate-projection.ts";
import { memoryHomeAuthorizedHosts } from "./agent-memory-home.ts";
import { activeAgentExclusiveOperationParticipantIds } from "./agent-exclusive-operation-lease.ts";
import { busyWorkspaceMountRevisionIds } from "./workspace-lease.ts";
import { activationHoldsLanePredicate } from "./activation-retry-fence.ts";

/** Read-only scheduler projection. Caller retains the scheduling transaction,
 * authentication, evidence trust, reservation mutations and execution fencing. */
export function projectPlacementPlannerInput(input: {
  database: DatabaseSync;
  now: Date;
  schedulerVersion: string;
  defaultMaxConcurrent: number;
  hostLimits: ReadonlyMap<string, number>;
  poolLimits: ReadonlyMap<string, number>;
  profileLimits: ReadonlyMap<string, number>;
  sharing: InPlaceWorkspaceSharing;
  readRuntimeOffer(row: Row): RuntimeOfferProjection;
  isTrustedOffer(offer: RuntimeOfferProjection): boolean;
  readPlacement(row: Row): PlacementDecision;
  readAgentRevision?(id: string): AgentDefinitionRevision;
  readExecutionPolicy?(id: string): ExecutionPolicyRevision;
}): PlacementPlannerInput {
  const { now, schedulerVersion } = input;
  const offerRows = input.database
    .prepare(
      `SELECT runtime_offers.*
         FROM runtime_offers
         JOIN agent_hosts ON agent_hosts.host_id = runtime_offers.host_id
         WHERE runtime_offers.lease_until_ms > ?
           AND agent_hosts.state = 'online'
           AND agent_hosts.instance_id = runtime_offers.host_instance_id
         ORDER BY runtime_offers.runtime_offer_id`,
    )
    .all(now.getTime());
  const offers = offerRows
    .map((row) => input.readRuntimeOffer(row))
    .filter((offer) => input.isTrustedOffer(offer));
  const workspaceDefinitionIds = [
    ...new Set(
      offers.flatMap((offer) =>
        offer.workspaceMountDescriptors.map(
          (workspace) => workspace.workspaceDefinitionId,
        ),
      ),
    ),
  ].sort();
  const workspaceDefinitionId =
    workspaceDefinitionIds.length === 1
      ? workspaceDefinitionIds[0]!
      : "workspace-unconfigured";

  const candidates = projectPlacementCandidates({
    database: input.database,
    now,
    workspaceDefinitionId,
    ...(input.readAgentRevision === undefined
      ? {}
      : { readAgentRevision: input.readAgentRevision }),
    ...(input.readExecutionPolicy === undefined
      ? {}
      : { readExecutionPolicy: input.readExecutionPolicy }),
  });

  const hostRows = input.database
    .prepare(
      "SELECT * FROM agent_hosts WHERE state = 'online' ORDER BY host_id",
    )
    .all();
  const reservationRows = input.database
    .prepare(
      "SELECT placement_id, resource_type, resource_id FROM placement_capacity_reservations ORDER BY placement_id, resource_type, resource_id",
    )
    .all();
  const reservationKeys = new Set<string>();
  const reservedByResource = new Map<string, number>();
  for (const row of reservationRows) {
    const placementId = text(row, "placement_id");
    const resourceType = text(row, "resource_type");
    const resourceId = text(row, "resource_id");
    reservationKeys.add(`${placementId}:${resourceType}:${resourceId}`);
    const resourceKey = `${resourceType}:${resourceId}`;
    reservedByResource.set(
      resourceKey,
      (reservedByResource.get(resourceKey) ?? 0) + 1,
    );
  }
  const unprovenRuntimePlacementRows = input.database
    .prepare(
      `SELECT DISTINCT placements.*
         FROM placements
         JOIN run_attempts ON run_attempts.placement_id = placements.placement_id
         JOIN runtime_processes
           ON runtime_processes.run_attempt_id = run_attempts.run_attempt_id
         WHERE runtime_processes.state <> 'terminated'
         ORDER BY placements.placement_id`,
    )
    .all();
  const unprovenRuntimePlacements = unprovenRuntimePlacementRows.map((row) => ({
    placement: input.readPlacement(row),
    runtimeProfileId: text(row, "runtime_profile_id"),
  }));
  for (const { placement, runtimeProfileId } of unprovenRuntimePlacements) {
    const implicitResources: Array<
      ["host" | "offer" | "pool" | "profile", string]
    > = [
      ["offer", placement.runtimeOfferId],
      ["host", placement.hostId],
      [
        "profile",
        capacityProfileResourceId(placement.hostId, runtimeProfileId),
      ],
      ...placement.capacityPoolIds.map((capacityPoolId): ["pool", string] => [
        "pool",
        capacityPoolId,
      ]),
    ];
    for (const [resourceType, resourceId] of implicitResources) {
      const reservationKey = `${placement.placementId}:${resourceType}:${resourceId}`;
      if (reservationKeys.has(reservationKey)) continue;
      reservationKeys.add(reservationKey);
      const resourceKey = `${resourceType}:${resourceId}`;
      reservedByResource.set(
        resourceKey,
        (reservedByResource.get(resourceKey) ?? 0) + 1,
      );
    }
  }
  const reserved = (resourceType: string, resourceId: string): number =>
    reservedByResource.get(`${resourceType}:${resourceId}`) ?? 0;
  const uniqueHosts = new Map<
    string,
    { adminMaxConcurrent: number; hostId: string; reserved: number }
  >();
  const uniqueProfiles = new Map<
    string,
    {
      adminMaxConcurrent: number;
      hostId: string;
      reserved: number;
      runtimeProfileId: string;
    }
  >();
  const uniquePools = new Map<
    string,
    {
      adminMaxConcurrent: number;
      capacityPoolId: string;
      reserved: number;
    }
  >();
  for (const offer of offers) {
    uniqueHosts.set(offer.hostId, {
      adminMaxConcurrent:
        input.hostLimits.get(offer.hostId) ?? input.defaultMaxConcurrent,
      hostId: offer.hostId,
      reserved: reserved("host", offer.hostId),
    });
    uniqueProfiles.set(
      capacityProfileResourceId(offer.hostId, offer.runtimeProfileId),
      {
        adminMaxConcurrent:
          input.profileLimits.get(
            capacityProfileResourceId(offer.hostId, offer.runtimeProfileId),
          ) ?? input.defaultMaxConcurrent,
        hostId: offer.hostId,
        reserved: reserved(
          "profile",
          capacityProfileResourceId(offer.hostId, offer.runtimeProfileId),
        ),
        runtimeProfileId: offer.runtimeProfileId,
      },
    );
    for (const capacityPoolId of offer.capacityPoolIds) {
      uniquePools.set(capacityPoolId, {
        adminMaxConcurrent:
          input.poolLimits.get(capacityPoolId) ?? input.defaultMaxConcurrent,
        capacityPoolId,
        reserved: reserved("pool", capacityPoolId),
      });
    }
  }

  return {
    activeHostInstances: hostRows.map((row) => ({
      hostId: text(row, "host_id"),
      hostInstanceId: text(row, "instance_id"),
    })),
    activeParticipantIds: [
      ...new Set([
        ...input.database
          .prepare(
            `SELECT DISTINCT participant_id FROM activations AS lane_holder WHERE ${activationHoldsLanePredicate("lane_holder")} ORDER BY participant_id`,
          )
          .all(now.getTime())
          .map((row) => text(row, "participant_id")),
        ...input.database
          .prepare(
            "SELECT DISTINCT participant_id FROM runtime_processes WHERE state <> 'terminated' ORDER BY participant_id",
          )
          .all()
          .map((row) => text(row, "participant_id")),
        ...activeAgentExclusiveOperationParticipantIds(input.database),
      ]),
    ].sort(),
    authorizedHostParticipants: memoryHomeAuthorizedHosts(
      input.database,
      hostRows,
    ),
    busyWorkspaceMountRevisionIds: busyWorkspaceMountRevisionIds({
      database: input.database,
      sharing: input.sharing,
      unprovenRuntimePlacements,
    }),
    candidates,
    capacities: {
      hosts: [...uniqueHosts.values()],
      offers: offers.map((offer) => ({
        reserved: reserved("offer", offer.runtimeOfferId),
        runtimeOfferId: offer.runtimeOfferId,
        structuralFailureCount: 0,
      })),
      pools: [...uniquePools.values()],
      profiles: [...uniqueProfiles.values()],
    },
    now: now.toISOString(),
    offers,
    schedulerVersion,
  };
}
