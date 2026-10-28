import { roleRuntimeOffer } from "./role-runtime-offer.ts";
import { allocateRecreatedAgentHandle } from "./message-reference-identity.ts";
import type { DatabaseSync } from "node:sqlite";

import {
  RuntimeLaunchEnvironmentSchema,
  AgentCatalogEntrySchema,
  AgentExecutionWorkspaceSchema,
  AgentDefinitionRevisionSchema,
  AgentDefinitionSchema,
  ExecutionPolicyRevisionSchema,
  type RoomEvent,
} from "@rah-os/protocol";

import { canonicalDigest } from "./canonical-digest.ts";
import { allocateAgentAvatarKey } from "./agent-avatar-allocation.ts";
import {
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  NotFoundError,
  StaleContextError,
} from "./errors.ts";
import { eventPayloadText } from "./event-payload.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import {
  assertRuntimeOfferSupportsToolAccess,
  currentRuntimeOfferFromRow,
} from "./runtime-offer-tool-access.ts";
import { principalHandleIsAvailable } from "./message-reference-identity.ts";
import {
  integer,
  jsonObject,
  nullableText,
  stringArray,
  text,
  type Row,
} from "./sqlite-row.ts";
import type {
  AgentDefinitionContent,
  ExecutionPolicyContent,
  WorkspaceAgentProvisionInput,
  WorkspaceAgentProvisionResult,
} from "./types.ts";

type WorkspaceAgentProvisioningOwner = {
  roleInstance?: { roleId: string; roleRevisionId: string; channelId: string };
  actorId: string;
  createId: (prefix: string) => string;
  database: DatabaseSync;
  events: RoomEventWriter;
  now: () => Date;
};

/**
 * Creates the complete persistent Workspace Agent aggregate.
 *
 * The caller owns Human manager authorization and the surrounding SQLite
 * transaction. This owner module owns normalization, idempotent replay,
 * immutable Agent/Policy creation, and the live Host authorization grant.
 */
export function provisionWorkspaceAgentTransaction(
  owner: WorkspaceAgentProvisioningOwner,
  input: WorkspaceAgentProvisionInput,
): WorkspaceAgentProvisionResult {
  const normalized = normalizeWorkspaceAgentProvisionInput(
    input,
    owner.roleInstance !== undefined,
  );
  const requestDigest = canonicalDigest({
    domain: "rah/workspace-agent-provision/v1",
    ...normalized,
  });
  const previous = owner.database
    .prepare(
      "SELECT * FROM room_events WHERE room_id = ? AND idempotency_key = ?",
    )
    .get(input.controlRoomId, input.idempotencyKey);
  if (previous !== undefined) {
    const event = owner.events.eventFromRow(previous);
    if (
      event.type !== "agent.provisioned" ||
      event.actorId !== owner.actorId ||
      event.payload.requestDigest !== requestDigest
    ) {
      throw new IdempotencyConflictError(
        `idempotency key ${input.idempotencyKey} was already used for another mutation`,
      );
    }
    return workspaceAgentProvisionResult(owner.database, event, true);
  }

  const controlRoom = requireRow(
    owner.database
      .prepare("SELECT * FROM rooms WHERE room_id = ?")
      .get(input.controlRoomId),
    `Room ${input.controlRoomId} was not found`,
  );
  const latestRoomSeq = integer(controlRoom, "next_seq") - 1;
  if (!Number.isInteger(input.basedOnRoomSeq) || input.basedOnRoomSeq < 0) {
    throw new Error("basedOnRoomSeq must be a non-negative integer");
  }
  if (input.basedOnRoomSeq !== latestRoomSeq) {
    throw new StaleContextError(input.basedOnRoomSeq, latestRoomSeq);
  }
  if (text(controlRoom, "kind") !== "control") {
    throw new ForbiddenError(
      `Room ${input.controlRoomId} is not a Workspace control Room`,
    );
  }
  const handle = allocateRecreatedAgentHandle(
    owner.database,
    normalized.handle,
  );
  if (!principalHandleIsAvailable(owner.database, handle)) {
    throw new ConflictError(
      `Agent name "${normalized.handle}" is already taken`,
    );
  }

  const offerRow = requireRow(
    owner.database
      .prepare("SELECT * FROM runtime_offers WHERE runtime_offer_id = ?")
      .get(normalized.runtimeOfferId),
    `RuntimeOffer ${normalized.runtimeOfferId} was not found`,
  );
  const pinned = currentRuntimeOfferFromRow(offerRow);
  const live = (candidate: typeof pinned) =>
    candidate.state === "available" &&
    Date.parse(candidate.leaseUntil) > owner.now().getTime();
  // A user-installed CLI that updated itself is published as a new
  // RuntimeProfile revision (a new Offer). A Role instance follows the
  // available Offer of the same profile on the same Host — the rule the
  // daemon applies to existing Agents at startup
  // (`local-workbench-runtime-bindings.ts`). Exact identity only: another
  // profile would be another CLI.
  const offer =
    live(pinned) || owner.roleInstance === undefined
      ? pinned
      : roleRuntimeOffer(
          owner.database,
          normalized.runtimeOfferId,
          owner.now().getTime(),
        );
  if (!live(offer)) {
    throw new ConflictError(
      `RuntimeOffer ${pinned.runtimeOfferId} is not currently available`,
    );
  }
  const hostRow = requireRow(
    owner.database
      .prepare("SELECT * FROM agent_hosts WHERE host_id = ?")
      .get(offer.hostId),
    `Host ${offer.hostId} was not found`,
  );
  const hostCredentialId = nullableText(hostRow, "credential_id");
  if (
    hostCredentialId === null ||
    text(hostRow, "instance_id") !== offer.hostInstanceId ||
    text(hostRow, "state") !== "online"
  ) {
    throw new ConflictError(
      `RuntimeOffer ${offer.runtimeOfferId} has no active authenticated Host`,
    );
  }
  const workspaceId = text(controlRoom, "workspace_id");
  if (
    !offer.workspaceMountDescriptors.some(
      (candidate) =>
        candidate.workspaceDefinitionId === workspaceId &&
        candidate.modes.includes("in_place"),
    )
  ) {
    throw new ConflictError(
      `RuntimeOffer ${offer.runtimeOfferId} is not mounted for Workspace ${workspaceId}`,
    );
  }
  assertRuntimeOfferSupportsToolAccess(
    offer,
    normalized.toolAccessMode ?? "full_access",
  );

  // Owner 2026-09-26: a new instance of a Channel created with a platform
  // home runs in that home. Channels created before it keep per-instance
  // private cwds (existing instances keep theirs: their revisions are frozen).
  const channelHome =
    owner.roleInstance !== undefined &&
    typeof owner.database
      .prepare("SELECT channel_workspace_json FROM rooms WHERE room_id = ?")
      .get(owner.roleInstance.channelId)?.channel_workspace_json === "string";
  const executionWorkspace =
    normalized.executionWorkspace ??
    (offer.supportsAgentPrivateWorkspace === true
      ? channelHome
        ? {
            kind: "channel_home" as const,
            roomId: owner.roleInstance!.channelId,
          }
        : { kind: "agent_private" as const }
      : undefined);
  if (
    (executionWorkspace?.kind === "agent_private" ||
      executionWorkspace?.kind === "channel_home") &&
    offer.supportsAgentPrivateWorkspace !== true
  )
    throw new ConflictError(
      "Selected Computer does not support Agent private execution workspaces",
    );
  if (
    executionWorkspace?.kind === "existing_mount" &&
    !offer.workspaceMountDescriptors.some(
      (m) =>
        m.participantId === undefined &&
        m.workspaceDefinitionId === workspaceId &&
        m.workspaceMountRevisionId ===
          executionWorkspace.workspaceMountRevisionId,
    )
  )
    throw new ForbiddenError(
      "Requested existing execution mount is not available on this Computer",
    );
  const createdAt = owner.now().toISOString();
  const participantId = owner.createId("principal");
  const executionPolicyId = owner.createId("execution_policy");
  const executionPolicyRevisionId = owner.createId("execution_policy_revision");
  const agentId = owner.createId("agent_definition");
  const agentDefinitionRevisionId = owner.createId("agent_definition_revision");

  owner.database
    .prepare(
      "INSERT INTO principals(principal_id, handle, kind, created_at) VALUES(?, ?, 'agent', ?)",
    )
    .run(participantId, handle, createdAt);
  owner.database
    .prepare(
      "INSERT INTO memberships(room_id, principal_id, role, joined_at) VALUES(?, ?, 'member', ?)",
    )
    .run(input.controlRoomId, participantId, createdAt);
  owner.events.append({
    actorId: owner.actorId,
    aggregateId: participantId,
    aggregateType: "membership",
    idempotencyKey: `${input.idempotencyKey}:membership`,
    payload: {
      basedOnRoomSeq: input.basedOnRoomSeq,
      participantId,
      role: "member",
    },
    roomId: input.controlRoomId,
    type: "membership.added",
  });

  const policyContent: ExecutionPolicyContent = {
    modelIntent: normalized.modelIntent,
    preferred: [],
    required: {
      allowedOfferIds: [offer.runtimeOfferId],
      allowedProtocolFamilies: [offer.protocolFamily],
      capabilities: [],
      minimumIsolation: "none",
      workspaceMode: "in_place",
    },
    retryPolicyRef: builtinContentRef(
      "retry-policy",
      "rah/retry-policy/default-v1",
      { backoff: "bounded", maxAttempts: 3 },
    ),
    sessionPolicy: normalized.sessionPolicy,
    toolAccessMode: normalized.toolAccessMode ?? "full_access",
  };
  const policy = ExecutionPolicyRevisionSchema.parse({
    ...policyContent,
    contentDigest: canonicalDigest(policyContent),
    controlRoomId: input.controlRoomId,
    createdAt,
    createdBy: owner.actorId,
    executionPolicyId,
    executionPolicyRevisionId,
    revision: 1,
  });
  owner.database
    .prepare(
      "INSERT INTO execution_policies(execution_policy_id, control_room_id, current_revision_id, created_at, updated_at) VALUES(?, ?, ?, ?, ?)",
    )
    .run(
      executionPolicyId,
      input.controlRoomId,
      executionPolicyRevisionId,
      createdAt,
      createdAt,
    );
  insertExecutionPolicyRevision(owner.database, policy);
  owner.events.append({
    actorId: owner.actorId,
    aggregateId: executionPolicyId,
    aggregateType: "execution_policy",
    idempotencyKey: `${input.idempotencyKey}:policy`,
    payload: {
      basedOnRoomSeq: input.basedOnRoomSeq + 1,
      contentDigest: policy.contentDigest,
      executionPolicyId,
      executionPolicyRevisionId,
      revision: 1,
    },
    roomId: input.controlRoomId,
    type: "policy.created",
  });

  const definitionContent: AgentDefinitionContent = {
    ...(normalized.environment === undefined
      ? {}
      : { environment: normalized.environment }),
    ...(executionWorkspace === undefined ? {} : { executionWorkspace }),
    avatarKey:
      normalized.avatarKey ??
      allocateAgentAvatarKey(owner.database, input.controlRoomId),
    ...(normalized.description === undefined
      ? {}
      : { description: normalized.description }),
    displayName: normalized.displayName,
    executionPolicyRevisionId,
    instructionRefs: [],
    instructions: normalized.instructions,
    memoryPolicyRef: builtinContentRef(
      "memory-policy",
      "rah/memory-policy/room-and-private-v1",
      { privateScratch: true, roomHistory: true },
    ),
    role: normalized.role,
    skillRefs: [],
  };
  const definition = AgentDefinitionSchema.parse({
    agentId,
    controlRoomId: input.controlRoomId,
    createdAt,
    currentRevisionId: agentDefinitionRevisionId,
    participantId,
    state: "enabled",
    updatedAt: createdAt,
  });
  const revision = AgentDefinitionRevisionSchema.parse({
    ...definitionContent,
    agentId,
    agentDefinitionRevisionId,
    contentDigest: canonicalDigest(definitionContent),
    createdAt,
    createdBy: owner.actorId,
    revision: 1,
  });
  owner.database
    .prepare(
      "INSERT INTO agent_definitions(agent_definition_id, participant_id, control_room_id, state, current_revision_id, created_at, updated_at) VALUES(?, ?, ?, 'enabled', ?, ?, ?)",
    )
    .run(
      agentId,
      participantId,
      input.controlRoomId,
      agentDefinitionRevisionId,
      createdAt,
      createdAt,
    );
  insertAgentDefinitionRevision(owner.database, revision);
  owner.events.append({
    actorId: owner.actorId,
    aggregateId: agentId,
    aggregateType: "agent_definition",
    idempotencyKey: `${input.idempotencyKey}:definition`,
    payload: {
      agentId,
      agentDefinitionRevisionId,
      basedOnRoomSeq: input.basedOnRoomSeq + 2,
      contentDigest: revision.contentDigest,
      participantId,
      revision: 1,
    },
    roomId: input.controlRoomId,
    type: "agent.created",
  });

  grantHostParticipant(
    owner.database,
    hostCredentialId,
    offer.hostId,
    participantId,
    createdAt,
    owner.now().getTime(),
  );
  const event = owner.events.append({
    actorId: owner.actorId,
    aggregateId: agentId,
    aggregateType: "agent_definition",
    idempotencyKey: input.idempotencyKey,
    payload: {
      agentId,
      agentDefinitionRevisionId,
      executionPolicyRevisionId,
      hostId: offer.hostId,
      participantId,
      requestDigest,
      runtimeOfferId: offer.runtimeOfferId,
      runtimeProfileId: offer.runtimeProfileId,
      runtimeProfileRevisionId: offer.runtimeProfileRevisionId,
    },
    roomId: input.controlRoomId,
    type: "agent.provisioned",
  });
  if (owner.roleInstance)
    owner.database
      .prepare("INSERT INTO role_instances VALUES(?,?,?,?,?)")
      .run(
        participantId,
        agentId,
        owner.roleInstance.roleId,
        owner.roleInstance.roleRevisionId,
        owner.roleInstance.channelId,
      );
  return workspaceAgentProvisionResult(owner.database, event, false);
}

export function normalizeAgentDefinitionContent(
  input: AgentDefinitionContent,
): AgentDefinitionContent {
  return {
    ...(input.environment === undefined
      ? {}
      : {
          environment: RuntimeLaunchEnvironmentSchema.parse(input.environment),
        }),
    ...(input.avatarKey === undefined ? {} : { avatarKey: input.avatarKey }),
    ...(input.description === undefined
      ? {}
      : { description: input.description.trim() }),
    ...(input.displayName === undefined
      ? {}
      : { displayName: input.displayName.trim() }),
    ...(input.executionWorkspace === undefined
      ? {}
      : { executionWorkspace: input.executionWorkspace }),
    executionPolicyRevisionId: input.executionPolicyRevisionId,
    ...(input.instructions === undefined
      ? {}
      : { instructions: input.instructions.trim() }),
    instructionRefs: input.instructionRefs,
    memoryPolicyRef: input.memoryPolicyRef,
    role: input.role.trim(),
    skillRefs: input.skillRefs,
  };
}

export function normalizeExecutionPolicyContent(
  input: ExecutionPolicyContent,
): ExecutionPolicyContent {
  return {
    modelIntent: input.modelIntent,
    preferred: input.preferred,
    required: input.required,
    retryPolicyRef: input.retryPolicyRef,
    sessionPolicy: input.sessionPolicy,
    // Raft's Computer runtime is intentionally unattended and starts with
    // full tool access. Restricted modes remain explicit RAH OS policy
    // revisions; they are never inferred or silently upgraded by an adapter.
    toolAccessMode: input.toolAccessMode ?? "full_access",
  };
}

function insertExecutionPolicyRevision(
  database: DatabaseSync,
  policy: WorkspaceAgentProvisionResult["policy"],
): void {
  database
    .prepare(
      "INSERT INTO execution_policy_revisions(execution_policy_revision_id, execution_policy_id, control_room_id, revision, content_digest, policy_json, created_by, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      policy.executionPolicyRevisionId,
      policy.executionPolicyId,
      policy.controlRoomId,
      policy.revision,
      policy.contentDigest,
      JSON.stringify(policy),
      policy.createdBy,
      policy.createdAt,
    );
}

function insertAgentDefinitionRevision(
  database: DatabaseSync,
  revision: WorkspaceAgentProvisionResult["agent"]["currentRevision"],
): void {
  database
    .prepare(
      "INSERT INTO agent_definition_revisions(agent_definition_revision_id, agent_definition_id, revision, content_digest, definition_json, execution_policy_revision_id, created_by, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      revision.agentDefinitionRevisionId,
      revision.agentId,
      revision.revision,
      revision.contentDigest,
      JSON.stringify(revision),
      revision.executionPolicyRevisionId,
      revision.createdBy,
      revision.createdAt,
    );
}

function grantHostParticipant(
  database: DatabaseSync,
  credentialId: string,
  hostId: string,
  participantId: string,
  createdAt: string,
  nowMs: number,
): void {
  const credentialRow = database
    .prepare(
      "SELECT participant_ids_json FROM agent_host_credentials WHERE credential_id = ? AND host_id = ? AND revoked_at IS NULL",
    )
    .get(credentialId, hostId);
  if (credentialRow === undefined) {
    throw new ConflictError(
      `Host ${hostId} has no active credential for Agent authorization`,
    );
  }
  const participantIds = [
    ...new Set([
      ...stringArray(credentialRow, "participant_ids_json"),
      participantId,
    ]),
  ].sort();
  database
    .prepare(
      "UPDATE agent_host_credentials SET participant_ids_json = ? WHERE credential_id = ?",
    )
    .run(JSON.stringify(participantIds), credentialId);
  database
    .prepare(
      "UPDATE agent_hosts SET participant_ids_json = ? WHERE host_id = ? AND credential_id = ?",
    )
    .run(JSON.stringify(participantIds), hostId, credentialId);
}

export function workspaceAgentProvisionResult(
  database: DatabaseSync,
  event: RoomEvent,
  deduplicated: boolean,
): WorkspaceAgentProvisionResult {
  const definitionRow = requireRow(
    database
      .prepare("SELECT * FROM agent_definitions WHERE agent_definition_id = ?")
      .get(eventPayloadText(event, "agentId")),
    "provisioned AgentDefinition was not found",
  );
  const definition = AgentDefinitionSchema.parse({
    agentId: text(definitionRow, "agent_definition_id"),
    controlRoomId: text(definitionRow, "control_room_id"),
    createdAt: text(definitionRow, "created_at"),
    currentRevisionId: text(definitionRow, "current_revision_id"),
    participantId: text(definitionRow, "participant_id"),
    state: text(definitionRow, "state"),
    updatedAt: text(definitionRow, "updated_at"),
  });
  const revisionRow = requireRow(
    database
      .prepare(
        "SELECT definition_json FROM agent_definition_revisions WHERE agent_definition_revision_id = ?",
      )
      .get(eventPayloadText(event, "agentDefinitionRevisionId")),
    "provisioned AgentDefinition revision was not found",
  );
  const principalRow = requireRow(
    database
      .prepare("SELECT handle FROM principals WHERE principal_id = ?")
      .get(definition.participantId),
    "provisioned Agent principal was not found",
  );
  const policyRow = requireRow(
    database
      .prepare(
        "SELECT policy_json FROM execution_policy_revisions WHERE execution_policy_revision_id = ?",
      )
      .get(eventPayloadText(event, "executionPolicyRevisionId")),
    "provisioned Agent execution policy was not found",
  );
  return {
    agent: AgentCatalogEntrySchema.parse({
      currentRevision: AgentDefinitionRevisionSchema.parse(
        jsonObject(revisionRow, "definition_json"),
      ),
      definition,
      handle: text(principalRow, "handle"),
    }),
    deduplicated,
    event,
    hostBinding: {
      hostId: eventPayloadText(event, "hostId"),
      runtimeOfferId: eventPayloadText(event, "runtimeOfferId"),
      runtimeProfileId: eventPayloadText(event, "runtimeProfileId"),
      runtimeProfileRevisionId: eventPayloadText(
        event,
        "runtimeProfileRevisionId",
      ),
    },
    policy: ExecutionPolicyRevisionSchema.parse(
      jsonObject(policyRow, "policy_json"),
    ),
  };
}

function normalizeWorkspaceAgentProvisionInput(
  input: WorkspaceAgentProvisionInput,
  roleInstance = false,
): WorkspaceAgentProvisionInput & {
  sessionPolicy: "prefer_resume";
  toolAccessMode: "full_access";
} {
  if (
    input.sessionPolicy !== undefined &&
    input.sessionPolicy !== "prefer_resume"
  ) {
    throw new Error(
      "standard Raft policy owns Provider session reuse automatically",
    );
  }
  if (
    input.toolAccessMode !== undefined &&
    input.toolAccessMode !== "full_access"
  ) {
    throw new Error("standard Raft policy requires full_access");
  }
  const handle = requiredBoundedText(
    input.handle,
    "handle",
    roleInstance ? 128 : 64,
  );
  if (!roleInstance && !/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(handle)) {
    throw new Error(
      "handle may only contain letters, numbers, dots, underscores, and hyphens",
    );
  }
  const description = input.description?.trim();
  if (description !== undefined && description.length > 2_000) {
    throw new Error("description must not exceed 2000 characters");
  }
  const avatarKey = input.avatarKey?.trim();
  if (avatarKey !== undefined && avatarKey.length === 0) {
    throw new Error("avatarKey cannot be empty");
  }
  if (avatarKey !== undefined && avatarKey.length > 128) {
    throw new Error("avatarKey must not exceed 128 characters");
  }
  return {
    ...(input.environment === undefined
      ? {}
      : {
          environment: RuntimeLaunchEnvironmentSchema.parse(input.environment),
        }),
    ...(input.executionWorkspace === undefined
      ? {}
      : {
          executionWorkspace: AgentExecutionWorkspaceSchema.parse(
            input.executionWorkspace,
          ),
        }),
    ...(avatarKey === undefined ? {} : { avatarKey }),
    basedOnRoomSeq: input.basedOnRoomSeq,
    controlRoomId: requiredBoundedText(
      input.controlRoomId,
      "controlRoomId",
      512,
    ),
    ...(description === undefined ? {} : { description }),
    displayName: requiredBoundedText(input.displayName, "displayName", 128),
    handle,
    idempotencyKey: requiredBoundedText(
      input.idempotencyKey,
      "idempotencyKey",
      512,
    ),
    instructions: requiredBoundedText(
      input.instructions,
      "instructions",
      64 * 1_024,
    ),
    modelIntent: input.modelIntent,
    role: requiredBoundedText(input.role, "role", 512),
    runtimeOfferId: requiredBoundedText(
      input.runtimeOfferId,
      "runtimeOfferId",
      512,
    ),
    // Provider sessions are a Raft-style runtime detail: reuse when proven,
    // otherwise cold-start. Human clients never select a competing policy.
    sessionPolicy: "prefer_resume",
    toolAccessMode: "full_access",
  };
}

function requiredBoundedText(
  value: string,
  field: string,
  maximumLength: number,
): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${field} is required`);
  if (normalized.length > maximumLength) {
    throw new Error(
      `${field} must not exceed ${String(maximumLength)} characters`,
    );
  }
  return normalized;
}

function builtinContentRef(
  artifactId: string,
  versionId: string,
  content: Record<string, unknown>,
): { artifactId: string; contentDigest: string; versionId: string } {
  return {
    artifactId,
    contentDigest: canonicalDigest({
      content,
      domain: "rah/builtin-content/v1",
      versionId,
    }),
    versionId,
  };
}

function requireRow(row: Row | undefined, message: string): Row {
  if (row === undefined) throw new NotFoundError(message);
  return row;
}
