import type { DatabaseSync } from "node:sqlite";

import {
  AgentCatalogEntrySchema,
  AgentDefinitionRevisionSchema,
  AgentDefinitionSchema,
  ClientAgentManageRequestSchema,
  ClientAgentManageResponseSchema,
  ClientAgentGetResponseSchema,
  ExecutionPolicyRevisionSchema,
  RuntimeOfferProjectionSchema,
  type ClientAgentManageRequest,
  type ClientAgentManageResponse,
  type ClientAgentGetResponse,
  type RoomEvent,
} from "@rah-os/protocol";

import { canonicalDigest } from "./canonical-digest.ts";
import {
  requireHumanControlRoomManager,
  roomRole,
} from "./collaboration-policy.ts";
import {
  AgentExecutionPausedError,
  ConflictError,
  IdempotencyConflictError,
  NotFoundError,
  StaleContextError,
} from "./errors.ts";
import { eventPayloadOptionalText, eventPayloadText } from "./event-payload.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { updateAgentProfile } from "./workspace-agent-profile.ts";
import { assertRuntimeOfferSupportsToolAccess } from "./runtime-offer-tool-access.ts";
import {
  integer,
  jsonObject,
  nullableText,
  stringArray,
  text,
  type Row,
} from "./sqlite-row.ts";
import type { AgentDefinitionRecord } from "./types.ts";

export type WorkspaceAgentManagementOwner = {
  actorId: string;
  createId: (prefix: string) => string;
  database: DatabaseSync;
  events: RoomEventWriter;
  now: () => Date;
};

export function requireAgentExecutionEnabled(
  database: DatabaseSync,
  participantId: string,
): void {
  const row = database
    .prepare(
      "SELECT state FROM agent_definitions WHERE participant_id = ? LIMIT 1",
    )
    .get(participantId);
  if (row === undefined) return;
  const state = text(row, "state");
  if (state !== "enabled") {
    throw new AgentExecutionPausedError(`Agent ${participantId} is ${state}`);
  }
}

export function readAgentDefinition(
  database: DatabaseSync,
  agentDefinitionId: string,
): AgentDefinitionRecord {
  const row = requireRow(
    database
      .prepare("SELECT * FROM agent_definitions WHERE agent_definition_id = ?")
      .get(agentDefinitionId),
    `AgentDefinition ${agentDefinitionId} was not found`,
  );
  return {
    currentRevision: AgentDefinitionRevisionSchema.parse(
      jsonObject(
        requireRow(
          database
            .prepare(
              "SELECT definition_json FROM agent_definition_revisions WHERE agent_definition_revision_id = ?",
            )
            .get(text(row, "current_revision_id")),
          "current AgentDefinition revision was not found",
        ),
        "definition_json",
      ),
    ),
    definition: definitionFromRow(row),
  };
}

export function getWorkspaceAgentManagementView(
  database: DatabaseSync,
  actorId: string,
  agentDefinitionId: string,
): ClientAgentGetResponse {
  const record = readAgentDefinition(database, agentDefinitionId);
  requireHumanControlRoomManager(
    database,
    record.definition.controlRoomId,
    actorId,
  );
  const principal = requireRow(
    database
      .prepare("SELECT handle FROM principals WHERE principal_id = ?")
      .get(record.definition.participantId),
    `principal ${record.definition.participantId} was not found`,
  );
  const policy = ExecutionPolicyRevisionSchema.parse(
    jsonObject(
      requireRow(
        database
          .prepare(
            "SELECT policy_json FROM execution_policy_revisions WHERE execution_policy_revision_id = ?",
          )
          .get(record.currentRevision.executionPolicyRevisionId),
        "current ExecutionPolicy revision was not found",
      ),
      "policy_json",
    ),
  );
  return ClientAgentGetResponseSchema.parse({
    membershipRole: roomRole(
      database,
      record.definition.controlRoomId,
      record.definition.participantId,
    ),
    agent: {
      currentRevision: record.currentRevision,
      definition: record.definition,
      handle: text(principal, "handle"),
    },
    policy,
  });
}

export function manageWorkspaceAgentTransaction(
  owner: WorkspaceAgentManagementOwner,
  untrustedInput: ClientAgentManageRequest,
): ClientAgentManageResponse {
  const input = ClientAgentManageRequestSchema.parse(untrustedInput);
  const definitionRow = requireRow(
    owner.database
      .prepare("SELECT * FROM agent_definitions WHERE agent_definition_id = ?")
      .get(input.agentDefinitionId),
    `AgentDefinition ${input.agentDefinitionId} was not found`,
  );
  const controlRoomId = text(definitionRow, "control_room_id");
  requireHumanControlRoomManager(owner.database, controlRoomId, owner.actorId);
  const requestDigest = canonicalDigest({
    domain: "rah/workspace-agent-management/v1",
    ...input,
  });
  const previous = owner.database
    .prepare(
      "SELECT * FROM room_events WHERE room_id = ? AND idempotency_key = ?",
    )
    .get(controlRoomId, input.idempotencyKey);
  if (previous !== undefined) {
    const event = owner.events.eventFromRow(previous);
    if (
      event.actorId !== owner.actorId ||
      event.aggregateId !== input.agentDefinitionId ||
      event.payload.requestDigest !== requestDigest ||
      ![
        "agent.configured",
        "agent.profile_updated",
        "agent.enabled",
        "agent.disabled",
        "agent.tombstoned",
      ].includes(event.type)
    ) {
      throw new IdempotencyConflictError(
        `idempotency key ${input.idempotencyKey} was already used for another mutation`,
      );
    }
    return managementResultFromEvent(owner.database, event, true);
  }
  assertFreshControlRoom(owner.database, controlRoomId, input.basedOnRoomSeq);
  if (input.action === "update_profile") {
    const event = updateAgentProfile(owner, input, requestDigest);
    return managementResultFromEvent(owner.database, event, false);
  }
  if (input.action === "configure") {
    return configureAgent(
      owner,
      definitionRow,
      controlRoomId,
      input,
      requestDigest,
    );
  }
  return setAgentState(
    owner,
    definitionRow,
    controlRoomId,
    input,
    requestDigest,
  );
}

function configureAgent(
  owner: WorkspaceAgentManagementOwner,
  definitionRow: Row,
  controlRoomId: string,
  input: Extract<ClientAgentManageRequest, { action: "configure" }>,
  requestDigest: string,
): ClientAgentManageResponse {
  if (text(definitionRow, "state") === "tombstoned") {
    throw new ConflictError("a tombstoned Agent cannot be configured");
  }
  const participantId = text(definitionRow, "participant_id");
  const handleOwner = owner.database
    .prepare("SELECT principal_id FROM principals WHERE handle = ?")
    .get(input.handle);
  if (
    handleOwner !== undefined &&
    text(handleOwner, "principal_id") !== participantId
  ) {
    throw new ConflictError(
      `principal handle ${input.handle} is already in use`,
    );
  }
  const roomRow = requireRow(
    owner.database
      .prepare("SELECT workspace_id FROM rooms WHERE room_id = ?")
      .get(controlRoomId),
    `Room ${controlRoomId} was not found`,
  );
  const offerBinding = requireAvailableOffer(
    owner,
    input.runtimeOfferId,
    text(roomRow, "workspace_id"),
  );
  const currentRevision = AgentDefinitionRevisionSchema.parse(
    jsonObject(
      requireRow(
        owner.database
          .prepare(
            "SELECT definition_json FROM agent_definition_revisions WHERE agent_definition_revision_id = ?",
          )
          .get(text(definitionRow, "current_revision_id")),
        "current AgentDefinition revision was not found",
      ),
      "definition_json",
    ),
  );
  const currentPolicy = ExecutionPolicyRevisionSchema.parse(
    jsonObject(
      requireRow(
        owner.database
          .prepare(
            "SELECT policy_json FROM execution_policy_revisions WHERE execution_policy_revision_id = ?",
          )
          .get(currentRevision.executionPolicyRevisionId),
        "current ExecutionPolicy revision was not found",
      ),
      "policy_json",
    ),
  );
  // Configuring an Agent is also the migration boundary for historical rows:
  // Raft's product path has neither per-Agent restricted mode nor a visible
  // session strategy. Runtime session reuse is automatic and best-effort.
  const toolAccessMode = "full_access" as const;
  const sessionPolicy = "prefer_resume" as const;
  assertRuntimeOfferSupportsToolAccess(offerBinding.offer, toolAccessMode);
  const currentOfferId = currentPolicy.required.allowedOfferIds?.[0];
  let hostChanged = false;
  if (currentOfferId !== undefined) {
    const currentOfferRow = owner.database
      .prepare("SELECT host_id FROM runtime_offers WHERE runtime_offer_id = ?")
      .get(currentOfferId);
    if (
      currentOfferRow !== undefined &&
      text(currentOfferRow, "host_id") !== offerBinding.hostId
    ) {
      assertAgentQuiescent(owner.database, participantId);
      hostChanged = true;
    }
  }

  const createdAt = owner.now().toISOString();
  const executionPolicyRevisionId = owner.createId("execution_policy_revision");
  const policyContent = {
    modelIntent: input.modelIntent,
    preferred: [],
    required: {
      allowedOfferIds: [offerBinding.offer.runtimeOfferId],
      allowedProtocolFamilies: [offerBinding.offer.protocolFamily],
      capabilities: [],
      minimumIsolation: "none" as const,
      workspaceMode: "in_place" as const,
    },
    retryPolicyRef: currentPolicy.retryPolicyRef,
    sessionPolicy,
    toolAccessMode,
  };
  const policy = ExecutionPolicyRevisionSchema.parse({
    ...policyContent,
    contentDigest: canonicalDigest(policyContent),
    controlRoomId,
    createdAt,
    createdBy: owner.actorId,
    executionPolicyId: currentPolicy.executionPolicyId,
    executionPolicyRevisionId,
    revision: currentPolicy.revision + 1,
  });
  owner.database
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
  owner.database
    .prepare(
      "UPDATE execution_policies SET current_revision_id = ?, updated_at = ? WHERE execution_policy_id = ?",
    )
    .run(policy.executionPolicyRevisionId, createdAt, policy.executionPolicyId);

  const agentDefinitionRevisionId = owner.createId("agent_definition_revision");
  const revisionContent = {
    ...(input.avatarKey === undefined ? {} : { avatarKey: input.avatarKey }),
    ...(input.description === undefined
      ? {}
      : { description: input.description }),
    displayName: input.displayName,
    executionPolicyRevisionId,
    instructionRefs: currentRevision.instructionRefs,
    instructions: input.instructions,
    memoryPolicyRef: currentRevision.memoryPolicyRef,
    role: input.role,
    skillRefs: currentRevision.skillRefs,
  };
  const revision = AgentDefinitionRevisionSchema.parse({
    ...revisionContent,
    agentDefinitionId: input.agentDefinitionId,
    agentDefinitionRevisionId,
    contentDigest: canonicalDigest(revisionContent),
    createdAt,
    createdBy: owner.actorId,
    revision: currentRevision.revision + 1,
  });
  owner.database
    .prepare(
      "INSERT INTO agent_definition_revisions(agent_definition_revision_id, agent_definition_id, revision, content_digest, definition_json, execution_policy_revision_id, created_by, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      revision.agentDefinitionRevisionId,
      revision.agentDefinitionId,
      revision.revision,
      revision.contentDigest,
      JSON.stringify(revision),
      revision.executionPolicyRevisionId,
      revision.createdBy,
      revision.createdAt,
    );
  owner.database
    .prepare("UPDATE principals SET handle = ? WHERE principal_id = ?")
    .run(input.handle, participantId);
  owner.database
    .prepare(
      "UPDATE agent_definitions SET current_revision_id = ?, updated_at = ? WHERE agent_definition_id = ?",
    )
    .run(agentDefinitionRevisionId, createdAt, input.agentDefinitionId);
  if (hostChanged) {
    revokeHostParticipant(
      owner.database,
      participantId,
      createdAt,
      owner.now().getTime(),
    );
  }
  grantHostParticipant(
    owner.database,
    offerBinding.credentialId,
    offerBinding.hostId,
    participantId,
    createdAt,
    owner.now().getTime(),
  );
  const event = owner.events.append({
    actorId: owner.actorId,
    aggregateId: input.agentDefinitionId,
    aggregateType: "agent_definition",
    idempotencyKey: input.idempotencyKey,
    payload: {
      agentDefinitionId: input.agentDefinitionId,
      agentDefinitionRevisionId,
      agentState: text(definitionRow, "state"),
      basedOnRoomSeq: input.basedOnRoomSeq,
      executionPolicyRevisionId,
      handle: input.handle,
      hostId: offerBinding.hostId,
      participantId,
      requestDigest,
      runtimeOfferId: offerBinding.offer.runtimeOfferId,
      runtimeProfileId: offerBinding.offer.runtimeProfileId,
      runtimeProfileRevisionId: offerBinding.offer.runtimeProfileRevisionId,
    },
    roomId: controlRoomId,
    type: "agent.configured",
  });
  return managementResultFromEvent(owner.database, event, false);
}

function setAgentState(
  owner: WorkspaceAgentManagementOwner,
  definitionRow: Row,
  controlRoomId: string,
  input: Extract<ClientAgentManageRequest, { action: "set_state" }>,
  requestDigest: string,
): ClientAgentManageResponse {
  const previousState = text(definitionRow, "state");
  if (previousState === "tombstoned") {
    throw new ConflictError("a tombstoned Agent cannot change state");
  }
  if (previousState === input.state) {
    throw new ConflictError(`Agent is already ${input.state}`);
  }
  if (input.state === "tombstoned" && previousState !== "disabled") {
    throw new ConflictError("an Agent must be disabled before deletion");
  }
  const participantId = text(definitionRow, "participant_id");
  if (input.state === "tombstoned") {
    assertAgentQuiescent(owner.database, participantId);
  }
  const updatedAt = owner.now().toISOString();
  const currentRevisionId = text(definitionRow, "current_revision_id");
  const principalRow = requireRow(
    owner.database
      .prepare("SELECT handle FROM principals WHERE principal_id = ?")
      .get(participantId),
    `principal ${participantId} was not found`,
  );
  if (input.state === "tombstoned") {
    const memberships = owner.database
      .prepare(
        "SELECT room_id, role FROM memberships WHERE principal_id = ? ORDER BY room_id",
      )
      .all(participantId);
    for (const membership of memberships) {
      const roomId = text(membership, "room_id");
      const roomRow = requireRow(
        owner.database
          .prepare("SELECT next_seq FROM rooms WHERE room_id = ?")
          .get(roomId),
        `Room ${roomId} was not found`,
      );
      owner.events.append({
        actorId: owner.actorId,
        aggregateId: participantId,
        aggregateType: "membership",
        idempotencyKey: `${input.idempotencyKey}:membership:${roomId}`,
        payload: {
          basedOnRoomSeq: integer(roomRow, "next_seq") - 1,
          participantId,
          previousRole: text(membership, "role"),
        },
        roomId,
        type: "membership.removed",
      });
      owner.database
        .prepare(
          "DELETE FROM memberships WHERE room_id = ? AND principal_id = ?",
        )
        .run(roomId, participantId);
    }
    revokeHostParticipant(
      owner.database,
      participantId,
      updatedAt,
      owner.now().getTime(),
    );
  }
  owner.database
    .prepare(
      "UPDATE agent_definitions SET state = ?, updated_at = ? WHERE agent_definition_id = ?",
    )
    .run(input.state, updatedAt, input.agentDefinitionId);
  const event = owner.events.append({
    actorId: owner.actorId,
    aggregateId: input.agentDefinitionId,
    aggregateType: "agent_definition",
    idempotencyKey: input.idempotencyKey,
    payload: {
      agentDefinitionId: input.agentDefinitionId,
      agentDefinitionRevisionId: currentRevisionId,
      agentState: input.state,
      basedOnRoomSeq: input.basedOnRoomSeq,
      handle: text(principalRow, "handle"),
      participantId,
      previousState,
      requestDigest,
    },
    roomId: controlRoomId,
    type: `agent.${input.state === "tombstoned" ? "tombstoned" : input.state}`,
  });
  return managementResultFromEvent(owner.database, event, false);
}

function requireAvailableOffer(
  owner: WorkspaceAgentManagementOwner,
  runtimeOfferId: string,
  workspaceId: string,
) {
  const row = requireRow(
    owner.database
      .prepare(
        "SELECT offer_json FROM runtime_offers WHERE runtime_offer_id = ?",
      )
      .get(runtimeOfferId),
    `RuntimeOffer ${runtimeOfferId} was not found`,
  );
  const offer = RuntimeOfferProjectionSchema.parse(
    jsonObject(row, "offer_json"),
  );
  if (
    offer.state !== "available" ||
    Date.parse(offer.leaseUntil) <= owner.now().getTime()
  ) {
    throw new ConflictError(
      `RuntimeOffer ${offer.runtimeOfferId} is not currently available`,
    );
  }
  if (
    !offer.workspaceMountDescriptors.some(
      (mount) =>
        mount.workspaceDefinitionId === workspaceId &&
        mount.modes.includes("in_place"),
    )
  ) {
    throw new ConflictError(
      `RuntimeOffer ${offer.runtimeOfferId} is not mounted for Workspace ${workspaceId}`,
    );
  }
  const host = requireRow(
    owner.database
      .prepare("SELECT * FROM agent_hosts WHERE host_id = ?")
      .get(offer.hostId),
    `Host ${offer.hostId} was not found`,
  );
  const credentialId = nullableText(host, "credential_id");
  if (
    credentialId === null ||
    text(host, "instance_id") !== offer.hostInstanceId ||
    text(host, "state") !== "online"
  ) {
    throw new ConflictError(
      `RuntimeOffer ${offer.runtimeOfferId} has no active authenticated Host`,
    );
  }
  return { credentialId, hostId: offer.hostId, offer };
}

function assertAgentQuiescent(database: DatabaseSync, participantId: string) {
  const activation = database
    .prepare(
      "SELECT activation_id FROM activations WHERE participant_id = ? AND state IN ('queued', 'leased', 'quarantined') LIMIT 1",
    )
    .get(participantId);
  const task = database
    .prepare(
      "SELECT task_id FROM tasks WHERE assignee_id = ? AND state NOT IN ('completed', 'cancelled') LIMIT 1",
    )
    .get(participantId);
  const run = database
    .prepare(
      "SELECT run_attempt_id FROM run_attempts WHERE participant_id = ? AND state IN ('starting', 'running', 'orphaned') LIMIT 1",
    )
    .get(participantId);
  if (activation !== undefined || task !== undefined || run !== undefined) {
    throw new ConflictError(
      `Agent ${participantId} has active work and must be drained first`,
    );
  }
}

function managementResultFromEvent(
  database: DatabaseSync,
  event: RoomEvent,
  deduplicated: boolean,
): ClientAgentManageResponse {
  const definitionRow = requireRow(
    database
      .prepare("SELECT * FROM agent_definitions WHERE agent_definition_id = ?")
      .get(eventPayloadText(event, "agentDefinitionId")),
    "managed AgentDefinition was not found",
  );
  const revision = AgentDefinitionRevisionSchema.parse(
    jsonObject(
      requireRow(
        database
          .prepare(
            "SELECT definition_json FROM agent_definition_revisions WHERE agent_definition_revision_id = ?",
          )
          .get(eventPayloadText(event, "agentDefinitionRevisionId")),
        "managed AgentDefinition revision was not found",
      ),
      "definition_json",
    ),
  );
  const definition = AgentDefinitionSchema.parse({
    agentDefinitionId: text(definitionRow, "agent_definition_id"),
    controlRoomId: text(definitionRow, "control_room_id"),
    createdAt: text(definitionRow, "created_at"),
    currentRevisionId: revision.agentDefinitionRevisionId,
    participantId: eventPayloadText(event, "participantId"),
    state: eventPayloadText(event, "agentState"),
    updatedAt: event.createdAt,
  });
  const result: ClientAgentManageResponse = {
    agent: AgentCatalogEntrySchema.parse({
      currentRevision: revision,
      definition,
      handle: eventPayloadText(event, "handle"),
    }),
    deduplicated,
    event,
  };
  const policyRevisionId = eventPayloadOptionalText(
    event,
    "executionPolicyRevisionId",
  );
  if (policyRevisionId !== undefined) {
    const policy = ExecutionPolicyRevisionSchema.parse(
      jsonObject(
        requireRow(
          database
            .prepare(
              "SELECT policy_json FROM execution_policy_revisions WHERE execution_policy_revision_id = ?",
            )
            .get(policyRevisionId),
          "managed ExecutionPolicy revision was not found",
        ),
        "policy_json",
      ),
    );
    result.policy = policy;
    result.hostBinding = {
      hostId: eventPayloadText(event, "hostId"),
      runtimeOfferId: eventPayloadText(event, "runtimeOfferId"),
      runtimeProfileId: eventPayloadText(event, "runtimeProfileId"),
      runtimeProfileRevisionId: eventPayloadText(
        event,
        "runtimeProfileRevisionId",
      ),
    };
  }
  return ClientAgentManageResponseSchema.parse(result);
}

function grantHostParticipant(
  database: DatabaseSync,
  credentialId: string,
  hostId: string,
  participantId: string,
  updatedAt: string,
  updatedAtMs: number,
) {
  const credential = requireRow(
    database
      .prepare(
        "SELECT participant_ids_json FROM agent_host_credentials WHERE credential_id = ? AND host_id = ? AND revoked_at IS NULL",
      )
      .get(credentialId, hostId),
    `Host ${hostId} has no active credential for Agent authorization`,
  );
  const participantIds = [
    ...new Set([
      ...stringArray(credential, "participant_ids_json"),
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

function revokeHostParticipant(
  database: DatabaseSync,
  participantId: string,
  updatedAt: string,
  updatedAtMs: number,
) {
  const credentials = database
    .prepare(
      "SELECT credential_id, host_id, participant_ids_json FROM agent_host_credentials WHERE revoked_at IS NULL ORDER BY credential_id",
    )
    .all();
  for (const credential of credentials) {
    const participantIds = stringArray(
      credential,
      "participant_ids_json",
    ).filter((candidate) => candidate !== participantId);
    database
      .prepare(
        "UPDATE agent_host_credentials SET participant_ids_json = ? WHERE credential_id = ?",
      )
      .run(JSON.stringify(participantIds), text(credential, "credential_id"));
    database
      .prepare(
        "UPDATE agent_hosts SET participant_ids_json = ? WHERE host_id = ? AND credential_id = ?",
      )
      .run(
        JSON.stringify(participantIds),
        text(credential, "host_id"),
        text(credential, "credential_id"),
      );
  }
}

function assertFreshControlRoom(
  database: DatabaseSync,
  controlRoomId: string,
  basedOnRoomSeq: number,
) {
  const room = requireRow(
    database
      .prepare("SELECT next_seq FROM rooms WHERE room_id = ?")
      .get(controlRoomId),
    `Room ${controlRoomId} was not found`,
  );
  const latestRoomSeq = integer(room, "next_seq") - 1;
  if (basedOnRoomSeq !== latestRoomSeq) {
    throw new StaleContextError(basedOnRoomSeq, latestRoomSeq);
  }
}

function requireRow(row: Row | undefined, message: string): Row {
  if (row === undefined) throw new NotFoundError(message);
  return row;
}

function definitionFromRow(row: Row) {
  return AgentDefinitionSchema.parse({
    agentDefinitionId: text(row, "agent_definition_id"),
    controlRoomId: text(row, "control_room_id"),
    createdAt: text(row, "created_at"),
    currentRevisionId: text(row, "current_revision_id"),
    participantId: text(row, "participant_id"),
    state: text(row, "state"),
    updatedAt: text(row, "updated_at"),
  });
}
