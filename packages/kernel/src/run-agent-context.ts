import { requireActiveInstancePrivateBox } from "./instance-worker-scope.ts";
import type { DatabaseSync } from "node:sqlite";

import {
  AgentDefinitionRevisionSchema,
  AgentRuntimeContextSchema,
  type AgentRuntimeContext,
} from "@rah-os/protocol";

import { ConflictError, LeaseConflictError, NotFoundError } from "./errors.ts";
import { integer, jsonObject, text, type Row } from "./sqlite-row.ts";
import type { AuthenticatedHostContext } from "./auth.ts";
import { bindManagedAgentMemoryHome } from "./agent-memory-home.ts";

/** Called inside RunAttempt's existing Kernel transaction, after lease checks. */
export function prepareRunPlacement(
  database: DatabaseSync,
  activation: Row,
  host: AuthenticatedHostContext,
  now: string,
): Row | undefined {
  requireActiveInstancePrivateBox(database, text(activation, "room_id"));
  bindManagedAgentMemoryHome(
    database,
    text(activation, "participant_id"),
    host.hostId,
    now,
  );
  const activationId = text(activation, "activation_id");
  const placement = database
    .prepare(
      "SELECT * FROM placements WHERE activation_id = ? AND state IN ('reserved', 'consumed') ORDER BY created_at DESC LIMIT 1",
    )
    .get(activationId);
  if (
    placement !== undefined &&
    (text(placement, "host_id") !== host.hostId ||
      text(placement, "host_instance_id") !== host.instanceId ||
      integer(placement, "activation_attempt_number") !==
        integer(activation, "attempt_count"))
  ) {
    throw new LeaseConflictError(
      `placement for Activation ${activationId} belongs to another Host generation`,
    );
  }
  return placement;
}

export function agentRuntimeContextFromPlacement(
  database: DatabaseSync,
  placement: Row,
): AgentRuntimeContext {
  const revisionId = text(placement, "agent_definition_revision_id");
  const revisionRow = database
    .prepare(
      "SELECT definition_json FROM agent_definition_revisions WHERE agent_definition_revision_id = ?",
    )
    .get(revisionId);
  if (revisionRow === undefined) {
    throw new NotFoundError(
      `AgentDefinition revision ${revisionId} was not found`,
    );
  }
  const revision = AgentDefinitionRevisionSchema.parse(
    jsonObject(revisionRow, "definition_json"),
  );
  const definition = database
    .prepare(
      `SELECT agent_definitions.participant_id, principals.handle, role_instances.channel_id
         FROM agent_definitions
         JOIN principals ON principals.principal_id = agent_definitions.participant_id
         LEFT JOIN role_instances ON role_instances.instance_id = agent_definitions.participant_id
        WHERE agent_definitions.agent_definition_id = ?`,
    )
    .get(revision.agentId);
  const participantId = text(placement, "participant_id");
  if (
    definition === undefined ||
    text(definition, "participant_id") !== participantId
  ) {
    throw new ConflictError(
      `Placement AgentDefinition does not belong to participant ${participantId}`,
    );
  }
  return AgentRuntimeContextSchema.parse({
    agentDefinitionRevision: revision,
    ...(typeof definition.channel_id === "string"
      ? {
          instanceChannelId: definition.channel_id,
          // A prior prepared process may have created native context even if it
          // crashed before reporting its ID. Missing Host evidence must fail closed.
          instanceSessionRequired:
            database
              .prepare(
                "SELECT 1 FROM run_attempts r WHERE participant_id=? AND (runtime_run_id IS NOT NULL OR EXISTS (SELECT 1 FROM runtime_processes p WHERE p.run_attempt_id=r.run_attempt_id)) LIMIT 1",
              )
              .get(participantId) !== undefined,
        }
      : {}),
    handle: text(definition, "handle"),
    participantId,
    schemaVersion: 1,
  });
}
