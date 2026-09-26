import { activeInstancePrivateBoxPredicate } from "./instance-worker-scope.ts";
import type { DatabaseSync } from "node:sqlite";
import {
  AgentDefinitionRevisionSchema,
  ExecutionPolicyRevisionSchema,
  type AgentDefinitionRevision,
  type ExecutionPolicyRevision,
} from "@rah-os/protocol";
import { NotFoundError } from "./errors.ts";
import type { PlacementPlannerInput } from "./placement-planner.ts";
import { jsonObject, text } from "./sqlite-row.ts";

/** The stored AgentDefinition revision the scheduler places. */
export function readAgentDefinitionRevision(
  database: DatabaseSync,
  id: string,
): AgentDefinitionRevision {
  const row = database
    .prepare(
      "SELECT definition_json FROM agent_definition_revisions WHERE agent_definition_revision_id = ?",
    )
    .get(id);
  if (row === undefined)
    throw new NotFoundError(`AgentDefinition revision ${id} was not found`);
  return AgentDefinitionRevisionSchema.parse(
    jsonObject(row, "definition_json"),
  );
}

/** The stored execution policy revision the scheduler evaluates. */
export function readExecutionPolicyRevision(
  database: DatabaseSync,
  id: string,
): ExecutionPolicyRevision {
  const row = database
    .prepare(
      "SELECT policy_json FROM execution_policy_revisions WHERE execution_policy_revision_id = ?",
    )
    .get(id);
  if (row === undefined)
    throw new NotFoundError(`execution policy revision ${id} was not found`);
  return ExecutionPolicyRevisionSchema.parse(jsonObject(row, "policy_json"));
}

/** Read-only projection; transaction and authenticated scheduling remain in Kernel. */
export function projectPlacementCandidates(input: {
  database: DatabaseSync;
  now: Date;
  workspaceDefinitionId: string;
  readAgentRevision?(id: string): AgentDefinitionRevision;
  readExecutionPolicy?(id: string): ExecutionPolicyRevision;
}): PlacementPlannerInput["candidates"] {
  const readAgentRevision =
    input.readAgentRevision ??
    ((id: string) => readAgentDefinitionRevision(input.database, id));
  const readExecutionPolicy =
    input.readExecutionPolicy ??
    ((id: string) => readExecutionPolicyRevision(input.database, id));
  const candidateRows = input.database
    .prepare(
      `SELECT activations.*, agent_definitions.state AS agent_state,
                agent_definitions.current_revision_id AS agent_revision_id
         FROM activations
         JOIN agent_definitions
           ON agent_definitions.participant_id = activations.participant_id
         WHERE activations.state = 'queued'
           AND ${activeInstancePrivateBoxPredicate("activations.room_id")}
           AND activations.available_at_ms <= ?
           AND NOT EXISTS (
             SELECT 1 FROM room_agent_sos_holds AS hold
             WHERE hold.room_id = activations.room_id
           )
         ORDER BY activations.available_at_ms, activations.created_at, activations.activation_id`,
    )
    .all(input.now.getTime());
  return candidateRows.map((row) => {
    const revision = readAgentRevision(text(row, "agent_revision_id"));
    return {
      activationId: text(row, "activation_id"),
      agentDefinitionRevisionId: revision.agentDefinitionRevisionId,
      agentEnabled: text(row, "agent_state") === "enabled",
      ...(revision.executionWorkspace === undefined
        ? {}
        : { executionWorkspace: revision.executionWorkspace }),
      availableAt: text(row, "available_at"),
      createdAt: text(row, "created_at"),
      executionPolicy: readExecutionPolicy(revision.executionPolicyRevisionId),
      participantId: text(row, "participant_id"),
      priority: 0,
      roomId: text(row, "room_id"),
      workspaceDefinitionId: input.workspaceDefinitionId,
    };
  });
}
