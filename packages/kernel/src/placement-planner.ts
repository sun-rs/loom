import { createHash } from "node:crypto";

import type {
  AgentDefinitionRevision,
  CapabilityEvidenceLevel,
  ExecutionPolicyRevision,
  IsolationLevel,
  PlacementCandidateEvidence,
  PlacementDecision,
  PlacementHardRejectionReason,
  PlacementHoldReason,
  PlacementScoreEvidence,
  ResolvedModel,
  RuntimeOfferProjection,
  WorkspaceMountDescriptor,
} from "@rah-os/protocol";

const DEFAULT_HOLD_BACKOFF_MS = 30_000;

export type PlacementActivationCandidate = {
  activationId: string;
  roomId: string;
  participantId: string;
  agentDefinitionRevisionId: string;
  agentEnabled: boolean;
  executionWorkspace?: AgentDefinitionRevision["executionWorkspace"];
  executionPolicy: ExecutionPolicyRevision;
  workspaceDefinitionId: string;
  priority: number;
  availableAt: string;
  createdAt: string;
  holdUntil?: string;
};

export type PlacementPlannerInput = {
  now: string;
  schedulerVersion: string;
  holdBackoffMs?: number;
  candidates: PlacementActivationCandidate[];
  offers: RuntimeOfferProjection[];
  activeParticipantIds: string[];
  activeHostInstances: Array<{ hostId: string; hostInstanceId: string }>;
  authorizedHostParticipants: Array<{
    hostId: string;
    participantIds: string[];
  }>;
  busyWorkspaceMountRevisionIds: string[];
  capacities: {
    offers: Array<{
      runtimeOfferId: string;
      reserved: number;
      structuralFailureCount: number;
    }>;
    hosts: Array<{
      hostId: string;
      adminMaxConcurrent: number;
      reserved: number;
    }>;
    profiles: Array<{
      hostId: string;
      runtimeProfileId: string;
      adminMaxConcurrent: number;
      reserved: number;
    }>;
    pools: Array<{
      capacityPoolId: string;
      adminMaxConcurrent: number;
      reserved: number;
    }>;
  };
};

export type PlacementHoldDraft = {
  activationId: string;
  reason: PlacementHoldReason;
  dependencyKeys: string[];
  evaluatedAt: string;
  nextEvaluationAt: string;
};

export type PlacementSelection = Omit<
  PlacementDecision,
  "placementId" | "state" | "leaseUntil" | "createdAt"
>;

export type PlacementPlannerResult = {
  selection?: PlacementSelection;
  holds: PlacementHoldDraft[];
};

type CapacitySnapshot = {
  adminMaxConcurrent: number;
  reserved: number;
};

type PlannerIndexes = {
  activeHostInstances: Map<string, string>;
  authorizedParticipants: Map<string, Set<string>>;
  busyWorkspaceMountRevisionIds: Set<string>;
  offerCapacities: Map<
    string,
    { reserved: number; structuralFailureCount: number }
  >;
  hostCapacities: Map<string, CapacitySnapshot>;
  profileCapacities: Map<string, CapacitySnapshot>;
  poolCapacities: Map<string, CapacitySnapshot>;
};

type OfferEvaluation = {
  offer: RuntimeOfferProjection;
  hardRejectionReasons: PlacementHardRejectionReason[];
  dependencyKeys: string[];
  resolvedModel?: ResolvedModel;
  workspaceMount?: WorkspaceMountDescriptor;
  score?: PlacementScoreEvidence[];
  totalScore?: number;
};

const evidenceRanks: Record<CapabilityEvidenceLevel, number> = {
  declared: 0,
  probed: 1,
  certified: 2,
};

const isolationRanks: Record<IsolationLevel, number> = {
  none: 0,
  process: 1,
  platform: 2,
  container: 3,
};

function profileCapacityKey(hostId: string, runtimeProfileId: string): string {
  return `${hostId}\u0000${runtimeProfileId}`;
}

function createUniqueMap<T>(
  values: readonly T[],
  keyOf: (value: T) => string,
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = keyOf(value);
    if (result.has(key)) {
      throw new Error(`duplicate ${label}: ${key}`);
    }
    result.set(key, value);
  }
  return result;
}

function buildIndexes(input: PlacementPlannerInput): PlannerIndexes {
  const activeHostRows = createUniqueMap(
    input.activeHostInstances,
    (entry) => entry.hostId,
    "active Host",
  );
  const authorizationRows = createUniqueMap(
    input.authorizedHostParticipants,
    (entry) => entry.hostId,
    "Host authorization",
  );
  const offerCapacities = createUniqueMap(
    input.capacities.offers,
    (entry) => entry.runtimeOfferId,
    "offer capacity",
  );
  const hostCapacities = createUniqueMap(
    input.capacities.hosts,
    (entry) => entry.hostId,
    "Host capacity",
  );
  const profileCapacities = createUniqueMap(
    input.capacities.profiles,
    (entry) => profileCapacityKey(entry.hostId, entry.runtimeProfileId),
    "profile capacity",
  );
  const poolCapacities = createUniqueMap(
    input.capacities.pools,
    (entry) => entry.capacityPoolId,
    "capacity pool",
  );

  return {
    activeHostInstances: new Map(
      [...activeHostRows].map(([hostId, row]) => [hostId, row.hostInstanceId]),
    ),
    authorizedParticipants: new Map(
      [...authorizationRows].map(([hostId, row]) => [
        hostId,
        new Set(row.participantIds),
      ]),
    ),
    busyWorkspaceMountRevisionIds: new Set(input.busyWorkspaceMountRevisionIds),
    offerCapacities,
    hostCapacities,
    profileCapacities,
    poolCapacities,
  };
}

function compareCandidates(
  left: PlacementActivationCandidate,
  right: PlacementActivationCandidate,
): number {
  return (
    right.priority - left.priority ||
    Date.parse(left.availableAt) - Date.parse(right.availableAt) ||
    Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
    left.activationId.localeCompare(right.activationId)
  );
}

function addReason(
  reasons: Set<PlacementHardRejectionReason>,
  reason: PlacementHardRejectionReason,
): void {
  reasons.add(reason);
}

function isCapacitySnapshotValid(snapshot: CapacitySnapshot): boolean {
  return (
    Number.isSafeInteger(snapshot.adminMaxConcurrent) &&
    snapshot.adminMaxConcurrent > 0 &&
    Number.isSafeInteger(snapshot.reserved) &&
    snapshot.reserved >= 0
  );
}

function inspectCapacity(
  offer: RuntimeOfferProjection,
  indexes: PlannerIndexes,
  reasons: Set<PlacementHardRejectionReason>,
  dependencyKeys: Set<string>,
): CapacitySnapshot[] {
  const snapshots: CapacitySnapshot[] = [];
  const offerCapacity = indexes.offerCapacities.get(offer.runtimeOfferId);
  const hostCapacity = indexes.hostCapacities.get(offer.hostId);
  const profileCapacity = indexes.profileCapacities.get(
    profileCapacityKey(offer.hostId, offer.runtimeProfileId),
  );

  if (
    offerCapacity === undefined ||
    !Number.isSafeInteger(offerCapacity.reserved) ||
    offerCapacity.reserved < 0 ||
    !Number.isSafeInteger(offerCapacity.structuralFailureCount) ||
    offerCapacity.structuralFailureCount < 0
  ) {
    addReason(reasons, "capacity_unconfigured");
    dependencyKeys.add(`capacity:offer:${offer.runtimeOfferId}`);
  } else {
    const snapshot = {
      adminMaxConcurrent: offer.maxConcurrent,
      reserved: offerCapacity.reserved,
    };
    snapshots.push(snapshot);
    if (snapshot.reserved >= snapshot.adminMaxConcurrent) {
      addReason(reasons, "capacity_exhausted");
      dependencyKeys.add(`capacity:offer:${offer.runtimeOfferId}`);
    }
  }

  if (hostCapacity === undefined || !isCapacitySnapshotValid(hostCapacity)) {
    addReason(reasons, "capacity_unconfigured");
    dependencyKeys.add(`capacity:host:${offer.hostId}`);
  } else {
    snapshots.push(hostCapacity);
    if (hostCapacity.reserved >= hostCapacity.adminMaxConcurrent) {
      addReason(reasons, "capacity_exhausted");
      dependencyKeys.add(`capacity:host:${offer.hostId}`);
    }
  }

  if (
    profileCapacity === undefined ||
    !isCapacitySnapshotValid(profileCapacity)
  ) {
    addReason(reasons, "capacity_unconfigured");
    dependencyKeys.add(
      `capacity:profile:${offer.hostId}:${offer.runtimeProfileId}`,
    );
  } else {
    snapshots.push(profileCapacity);
    if (profileCapacity.reserved >= profileCapacity.adminMaxConcurrent) {
      addReason(reasons, "capacity_exhausted");
      dependencyKeys.add(
        `capacity:profile:${offer.hostId}:${offer.runtimeProfileId}`,
      );
    }
  }

  for (const capacityPoolId of [...offer.capacityPoolIds].sort()) {
    const poolCapacity = indexes.poolCapacities.get(capacityPoolId);
    if (poolCapacity === undefined || !isCapacitySnapshotValid(poolCapacity)) {
      addReason(reasons, "capacity_unconfigured");
      dependencyKeys.add(`capacity:pool:${capacityPoolId}`);
      continue;
    }
    snapshots.push(poolCapacity);
    if (poolCapacity.reserved >= poolCapacity.adminMaxConcurrent) {
      addReason(reasons, "capacity_exhausted");
      dependencyKeys.add(`capacity:pool:${capacityPoolId}`);
    }
  }

  return snapshots;
}

function resolveModel(
  offer: RuntimeOfferProjection,
  policy: ExecutionPolicyRevision,
): ResolvedModel | undefined {
  const intent = policy.modelIntent;
  if (intent.customModel) {
    if (offer.customModelRuntime !== intent.customModel.runtime)
      return undefined;
    return { source: "custom_model", ...intent.customModel };
  }
  const reasoning = intent.reasoning ?? "default";
  const serviceTier = intent.serviceTier ?? "default";
  const needsBinding =
    intent.exactBindingIds !== undefined ||
    intent.capabilityClass !== undefined ||
    reasoning !== "default" ||
    serviceTier !== "default";

  if (!needsBinding) {
    return {
      selection: "no_model_selector_sent",
      source: "runtime_default",
    };
  }

  const preferredBindingWeights = new Map<string, number>();
  for (const preference of policy.preferred) {
    if (preference.criterion === "model_binding") {
      preferredBindingWeights.set(preference.targetId, preference.weight);
    }
  }

  const compatible = offer.modelBindingDescriptors
    .filter(
      (binding) => evidenceRanks[binding.evidence] >= evidenceRanks.probed,
    )
    .filter(
      (binding) =>
        intent.exactBindingIds === undefined ||
        intent.exactBindingIds.includes(binding.modelBindingId),
    )
    .filter(
      (binding) =>
        intent.capabilityClass === undefined ||
        binding.capabilityClasses.includes(intent.capabilityClass),
    )
    .filter(
      (binding) =>
        reasoning === "default" ||
        binding.supportedReasoning.includes(reasoning),
    )
    .filter(
      (binding) =>
        serviceTier === "default" ||
        binding.supportedServiceTiers.includes(serviceTier),
    )
    .sort(
      (left, right) =>
        (preferredBindingWeights.get(right.modelBindingId) ?? 0) -
          (preferredBindingWeights.get(left.modelBindingId) ?? 0) ||
        left.modelBindingId.localeCompare(right.modelBindingId),
    );
  const selected = compatible[0];
  if (selected === undefined) return undefined;

  return {
    source: "explicit_binding",
    modelBindingId: selected.modelBindingId,
    provider: selected.provider,
    modelId: selected.modelId,
    ...(reasoning === "default" ? {} : { reasoning }),
    ...(serviceTier === "default" ? {} : { serviceTier }),
  };
}

function scoreOffer(
  offer: RuntimeOfferProjection,
  policy: ExecutionPolicyRevision,
  resolvedModel: ResolvedModel,
  capacities: readonly CapacitySnapshot[],
  structuralFailureCount: number,
): { score: PlacementScoreEvidence[]; totalScore: number } {
  const score = [...policy.preferred]
    .sort((left, right) => {
      const leftKey =
        "targetId" in left
          ? `${left.criterion}:${left.targetId}`
          : left.criterion;
      const rightKey =
        "targetId" in right
          ? `${right.criterion}:${right.targetId}`
          : right.criterion;
      return leftKey.localeCompare(rightKey);
    })
    .map((preference): PlacementScoreEvidence => {
      switch (preference.criterion) {
        case "runtime_offer":
          return {
            criterion: `${preference.criterion}:${preference.targetId}`,
            points:
              offer.runtimeOfferId === preference.targetId
                ? preference.weight
                : 0,
          };
        case "runtime_profile":
          return {
            criterion: `${preference.criterion}:${preference.targetId}`,
            points:
              offer.runtimeProfileId === preference.targetId
                ? preference.weight
                : 0,
          };
        case "protocol_family":
          return {
            criterion: `${preference.criterion}:${preference.targetId}`,
            points:
              offer.protocolFamily === preference.targetId
                ? preference.weight
                : 0,
          };
        case "model_binding":
          return {
            criterion: `${preference.criterion}:${preference.targetId}`,
            points:
              resolvedModel.source === "explicit_binding" &&
              resolvedModel.modelBindingId === preference.targetId
                ? preference.weight
                : 0,
          };
        case "lower_load": {
          const points = capacities.reduce(
            (lowest, capacity) =>
              Math.min(
                lowest,
                Math.floor(
                  (preference.weight *
                    (capacity.adminMaxConcurrent - capacity.reserved)) /
                    capacity.adminMaxConcurrent,
                ),
              ),
            preference.weight,
          );
          return { criterion: preference.criterion, points };
        }
        case "avoid_structural_failures":
          return {
            criterion: preference.criterion,
            points: -preference.weight * Math.min(structuralFailureCount, 100),
          };
      }
    });
  return {
    score,
    totalScore: score.reduce((total, evidence) => total + evidence.points, 0),
  };
}

function evaluateOffer(
  candidate: PlacementActivationCandidate,
  offer: RuntimeOfferProjection,
  input: PlacementPlannerInput,
  indexes: PlannerIndexes,
): OfferEvaluation {
  const reasons = new Set<PlacementHardRejectionReason>();
  const dependencyKeys = new Set<string>();
  const policy = candidate.executionPolicy;

  if (
    indexes.authorizedParticipants
      .get(offer.hostId)
      ?.has(candidate.participantId) !== true
  ) {
    addReason(reasons, "host_unauthorized");
    dependencyKeys.add(
      `authorization:${offer.hostId}:${candidate.participantId}`,
    );
  }
  if (indexes.activeHostInstances.get(offer.hostId) !== offer.hostInstanceId) {
    addReason(reasons, "host_generation_inactive");
    dependencyKeys.add(`host:${offer.hostId}`);
  }
  if (Date.parse(offer.leaseUntil) <= Date.parse(input.now)) {
    addReason(reasons, "offer_stale");
    dependencyKeys.add(`offer:${offer.runtimeOfferId}`);
  }
  if (offer.state === "draining" || offer.state === "unavailable") {
    addReason(reasons, "offer_unavailable");
    dependencyKeys.add(`offer:${offer.runtimeOfferId}`);
  }
  if (
    policy.required.authorizedHostIds !== undefined &&
    !policy.required.authorizedHostIds.includes(offer.hostId)
  ) {
    addReason(reasons, "host_unauthorized");
  }
  if (
    policy.required.allowedOfferIds !== undefined &&
    !policy.required.allowedOfferIds.includes(offer.runtimeOfferId)
  ) {
    addReason(reasons, "offer_not_allowed");
  }
  if (!policy.required.allowedProtocolFamilies.includes(offer.protocolFamily)) {
    addReason(reasons, "protocol_unsupported");
  }
  const supportedToolAccessModes = offer.supportedToolAccessModes ?? [
    "full_access",
  ];
  if (!supportedToolAccessModes.includes(policy.toolAccessMode)) {
    addReason(reasons, "tool_access_unsupported");
    dependencyKeys.add(
      `tool-access:${offer.runtimeOfferId}:${policy.toolAccessMode}`,
    );
  }

  const evidenceByCapability = new Map(
    offer.capabilityEvidence.map((evidence) => [
      evidence.capability,
      evidence.evidence,
    ]),
  );
  for (const requirement of policy.required.capabilities) {
    const actual = evidenceByCapability.get(requirement.capability);
    if (actual === undefined) {
      addReason(reasons, "capability_missing");
    } else if (
      evidenceRanks[actual] < evidenceRanks[requirement.minimumEvidence]
    ) {
      addReason(reasons, "capability_evidence_insufficient");
    }
  }

  if (
    isolationRanks[offer.isolation.level] <
      isolationRanks[policy.required.minimumIsolation] ||
    (policy.required.minimumIsolation !== "none" &&
      offer.isolation.evidence !== "certified")
  ) {
    addReason(reasons, "isolation_insufficient");
  }

  if (
    candidate.executionWorkspace?.kind === "agent_private" &&
    offer.supportsAgentPrivateWorkspace !== true
  )
    addReason(reasons, "private_workspace_unsupported");

  const workspaceCandidates = offer.workspaceMountDescriptors
    .filter(
      (workspace) =>
        workspace.workspaceDefinitionId === candidate.workspaceDefinitionId &&
        (candidate.executionWorkspace?.kind === "agent_private"
          ? workspace.participantId === candidate.participantId
          : workspace.participantId === undefined &&
            (candidate.executionWorkspace?.kind !== "existing_mount" ||
              workspace.workspaceMountRevisionId ===
                candidate.executionWorkspace.workspaceMountRevisionId)),
    )
    .sort((left, right) =>
      left.workspaceMountRevisionId.localeCompare(
        right.workspaceMountRevisionId,
      ),
    );
  const modeCompatibleWorkspaceMounts = workspaceCandidates.filter(
    (workspace) => workspace.modes.includes(policy.required.workspaceMode),
  );
  const workspaceMount = modeCompatibleWorkspaceMounts.find(
    (workspace) =>
      !indexes.busyWorkspaceMountRevisionIds.has(
        workspace.workspaceMountRevisionId,
      ),
  );
  if (workspaceCandidates.length === 0) {
    addReason(reasons, "workspace_unavailable");
    dependencyKeys.add(
      `workspace:${offer.hostId}:${candidate.workspaceDefinitionId}`,
    );
  } else if (modeCompatibleWorkspaceMounts.length === 0) {
    addReason(reasons, "workspace_mode_unsupported");
    dependencyKeys.add(
      `workspace:${offer.hostId}:${candidate.workspaceDefinitionId}`,
    );
  } else if (workspaceMount === undefined) {
    addReason(reasons, "workspace_busy");
    for (const busyMount of modeCompatibleWorkspaceMounts) {
      dependencyKeys.add(
        `workspace-mount:${busyMount.workspaceMountRevisionId}`,
      );
    }
  }

  const resolvedModel = resolveModel(offer, policy);
  if (resolvedModel === undefined) {
    addReason(reasons, "model_unavailable");
    dependencyKeys.add(`model:${offer.runtimeOfferId}`);
  }
  if (policy.sessionPolicy === "require_resume") {
    addReason(reasons, "session_locality_unavailable");
    dependencyKeys.add(
      `session:${candidate.participantId}:${offer.runtimeOfferId}`,
    );
  }

  const capacities = inspectCapacity(offer, indexes, reasons, dependencyKeys);
  const hardRejectionReasons = [...reasons].sort();
  if (
    hardRejectionReasons.length > 0 ||
    resolvedModel === undefined ||
    workspaceMount === undefined
  ) {
    return {
      dependencyKeys: [...dependencyKeys].sort(),
      hardRejectionReasons,
      offer,
    };
  }

  const score = scoreOffer(
    offer,
    policy,
    resolvedModel,
    capacities,
    indexes.offerCapacities.get(offer.runtimeOfferId)?.structuralFailureCount ??
      0,
  );
  return {
    dependencyKeys: [...dependencyKeys].sort(),
    hardRejectionReasons,
    offer,
    resolvedModel,
    workspaceMount,
    ...score,
  };
}

function toCandidateEvidence(
  evaluation: OfferEvaluation,
): PlacementCandidateEvidence {
  if (evaluation.hardRejectionReasons.length > 0) {
    return {
      hardRejectionReasons: evaluation.hardRejectionReasons,
      runtimeOfferId: evaluation.offer.runtimeOfferId,
      runtimeOfferObservationId: evaluation.offer.runtimeOfferObservationId,
      runtimeOfferSnapshotDigest: evaluation.offer.runtimeOfferSnapshotDigest,
      runtimeProfileRevisionId: evaluation.offer.runtimeProfileRevisionId,
    };
  }
  if (
    evaluation.resolvedModel === undefined ||
    evaluation.workspaceMount === undefined ||
    evaluation.score === undefined ||
    evaluation.totalScore === undefined
  ) {
    throw new Error("feasible offer evaluation is incomplete");
  }
  return {
    hardRejectionReasons: [],
    resolvedModel: evaluation.resolvedModel,
    runtimeOfferId: evaluation.offer.runtimeOfferId,
    runtimeOfferObservationId: evaluation.offer.runtimeOfferObservationId,
    runtimeOfferSnapshotDigest: evaluation.offer.runtimeOfferSnapshotDigest,
    runtimeProfileRevisionId: evaluation.offer.runtimeProfileRevisionId,
    score: evaluation.score,
    totalScore: evaluation.totalScore,
    workspaceMountRevisionId:
      evaluation.workspaceMount.workspaceMountRevisionId,
  };
}

function digestCandidateSet(
  activationId: string,
  schedulerVersion: string,
  evidence: readonly PlacementCandidateEvidence[],
): string {
  const encoded = JSON.stringify({
    domain: "rah/placement-candidate-set/v1",
    activationId,
    evidence,
    schedulerVersion,
  });
  return `sha256:${createHash("sha256").update(encoded).digest("hex")}`;
}

function selectHoldReason(
  evaluations: readonly OfferEvaluation[],
): PlacementHoldReason {
  const everyHas = (reason: PlacementHardRejectionReason) =>
    evaluations.length > 0 &&
    evaluations.every((evaluation) =>
      evaluation.hardRejectionReasons.includes(reason),
    );
  if (everyHas("capacity_unconfigured")) return "capacity_unconfigured";
  if (everyHas("capacity_exhausted")) return "capacity_exhausted";
  if (everyHas("workspace_busy")) return "workspace_busy";
  if (everyHas("model_unavailable")) return "model_unavailable";
  if (everyHas("session_locality_unavailable")) {
    return "session_locality_unavailable";
  }
  if (everyHas("circuit_open")) return "circuit_open";
  if (everyHas("host_unauthorized")) return "no_authorized_host";
  if (
    evaluations.length === 0 ||
    evaluations.every((evaluation) =>
      evaluation.hardRejectionReasons.some((reason) =>
        [
          "host_generation_inactive",
          "offer_stale",
          "offer_unavailable",
        ].includes(reason),
      ),
    )
  ) {
    return "profile_offline";
  }
  return "no_compatible_offer";
}

function buildHold(
  candidate: PlacementActivationCandidate,
  input: PlacementPlannerInput,
  reason: PlacementHoldReason,
  dependencyKeys: readonly string[],
): PlacementHoldDraft {
  const holdBackoffMs = input.holdBackoffMs ?? DEFAULT_HOLD_BACKOFF_MS;
  if (!Number.isSafeInteger(holdBackoffMs) || holdBackoffMs < 0) {
    throw new Error("holdBackoffMs must be a non-negative safe integer");
  }
  return {
    activationId: candidate.activationId,
    dependencyKeys: [...new Set(dependencyKeys)].sort(),
    evaluatedAt: input.now,
    nextEvaluationAt: new Date(
      Date.parse(input.now) + holdBackoffMs,
    ).toISOString(),
    reason,
  };
}

export function planNextPlacement(
  input: PlacementPlannerInput,
): PlacementPlannerResult {
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) throw new Error("now must be a timestamp");
  createUniqueMap(
    input.offers,
    (offer) => offer.runtimeOfferId,
    "runtime offer",
  );
  createUniqueMap(
    input.candidates,
    (candidate) => candidate.activationId,
    "Activation candidate",
  );
  const indexes = buildIndexes(input);
  const activeParticipants = new Set(input.activeParticipantIds);
  const offers = [...input.offers].sort((left, right) =>
    left.runtimeOfferId.localeCompare(right.runtimeOfferId),
  );
  const candidates = [...input.candidates]
    .filter((candidate) => Date.parse(candidate.availableAt) <= nowMs)
    .filter(
      (candidate) =>
        candidate.holdUntil === undefined ||
        Date.parse(candidate.holdUntil) <= nowMs,
    )
    .sort(compareCandidates);
  const holds: PlacementHoldDraft[] = [];

  for (const candidate of candidates) {
    if (!candidate.agentEnabled) {
      holds.push(
        buildHold(candidate, input, "agent_disabled", [
          `agent:${candidate.participantId}`,
        ]),
      );
      continue;
    }
    if (activeParticipants.has(candidate.participantId)) {
      holds.push(
        buildHold(candidate, input, "lane_busy", [
          `lane:${candidate.participantId}`,
        ]),
      );
      continue;
    }

    const evaluations = offers.map((offer) =>
      evaluateOffer(candidate, offer, input, indexes),
    );
    const feasible = evaluations
      .filter(
        (evaluation) =>
          evaluation.hardRejectionReasons.length === 0 &&
          evaluation.resolvedModel !== undefined &&
          evaluation.workspaceMount !== undefined &&
          evaluation.totalScore !== undefined,
      )
      .sort(
        (left, right) =>
          (right.totalScore ?? 0) - (left.totalScore ?? 0) ||
          left.offer.runtimeOfferId.localeCompare(right.offer.runtimeOfferId),
      );
    const selected = feasible[0];
    if (
      selected === undefined ||
      selected.resolvedModel === undefined ||
      selected.workspaceMount === undefined ||
      selected.totalScore === undefined
    ) {
      holds.push(
        buildHold(
          candidate,
          input,
          selectHoldReason(evaluations),
          evaluations.flatMap((evaluation) => evaluation.dependencyKeys),
        ),
      );
      continue;
    }

    const candidateEvidence = evaluations.map(toCandidateEvidence);
    return {
      holds,
      selection: {
        activationId: candidate.activationId,
        roomId: candidate.roomId,
        participantId: candidate.participantId,
        agentDefinitionRevisionId: candidate.agentDefinitionRevisionId,
        executionPolicyRevisionId:
          candidate.executionPolicy.executionPolicyRevisionId,
        hostId: selected.offer.hostId,
        hostInstanceId: selected.offer.hostInstanceId,
        provenanceVersion: "offer_observation_v1",
        runtimeOfferId: selected.offer.runtimeOfferId,
        runtimeOfferObservationId: selected.offer.runtimeOfferObservationId,
        runtimeOfferSnapshotDigest: selected.offer.runtimeOfferSnapshotDigest,
        runtimeProfileRevisionId: selected.offer.runtimeProfileRevisionId,
        runtimeProfileDigest: selected.offer.revisionDigest,
        protocolFamily: selected.offer.protocolFamily,
        resolvedModel: selected.resolvedModel,
        toolAccessMode: candidate.executionPolicy.toolAccessMode,
        workspaceDefinitionId: candidate.workspaceDefinitionId,
        workspaceMountRevisionId:
          selected.workspaceMount.workspaceMountRevisionId,
        workspaceMountDigest: selected.workspaceMount.workspaceMountDigest,
        workspaceMode: candidate.executionPolicy.required.workspaceMode,
        capacityPoolIds: [...selected.offer.capacityPoolIds].sort(),
        schedulerVersion: input.schedulerVersion,
        candidateSetDigest: digestCandidateSet(
          candidate.activationId,
          input.schedulerVersion,
          candidateEvidence,
        ),
        candidateEvidence,
      },
    };
  }

  return { holds };
}
