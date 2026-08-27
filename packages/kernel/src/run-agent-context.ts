import type { DatabaseSync } from "node:sqlite";

import {
  AgentDefinitionRevisionSchema,
  AgentRuntimeContextSchema,
  type AgentRuntimeContext,
} from "@rah-os/protocol";

import { ConflictError, NotFoundError } from "./errors.ts";
import { jsonObject, text, type Row } from "./sqlite-row.ts";

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
      "SELECT participant_id FROM agent_definitions WHERE agent_definition_id = ?",
    )
    .get(revision.agentDefinitionId);
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
    participantId,
    schemaVersion: 1,
  });
}
