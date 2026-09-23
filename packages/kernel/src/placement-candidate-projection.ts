import { activeInstancePrivateBoxPredicate } from "./instance-worker-scope.ts";
import type { DatabaseSync } from "node:sqlite";
import type {
  AgentDefinitionRevision,
  ExecutionPolicyRevision,
} from "@rah-os/protocol";
import type { PlacementPlannerInput } from "./placement-planner.ts";
import { text } from "./sqlite-row.ts";

/** Read-only projection; transaction and authenticated scheduling remain in Kernel. */
export function projectPlacementCandidates(input: {
  database: DatabaseSync;
  now: Date;
  workspaceDefinitionId: string;
  readAgentRevision(id: string): AgentDefinitionRevision;
  readExecutionPolicy(id: string): ExecutionPolicyRevision;
}): PlacementPlannerInput["candidates"] {
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
    const revision = input.readAgentRevision(text(row, "agent_revision_id"));
    return {
      activationId: text(row, "activation_id"),
      agentDefinitionRevisionId: revision.agentDefinitionRevisionId,
      agentEnabled: text(row, "agent_state") === "enabled",
      ...(revision.executionWorkspace === undefined
        ? {}
        : { executionWorkspace: revision.executionWorkspace }),
      availableAt: text(row, "available_at"),
      createdAt: text(row, "created_at"),
      executionPolicy: input.readExecutionPolicy(
        revision.executionPolicyRevisionId,
      ),
      participantId: text(row, "participant_id"),
      priority: 0,
      roomId: text(row, "room_id"),
      workspaceDefinitionId: input.workspaceDefinitionId,
    };
  });
}
