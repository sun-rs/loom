import {
  AgentDefinitionRevisionSchema,
  type ClientAgentProfileRequest,
} from "@rah-os/protocol";
import { canonicalDigest } from "./canonical-digest.ts";
import { ConflictError } from "./errors.ts";
import { text } from "./sqlite-row.ts";
import {
  readAgentDefinition,
  type WorkspaceAgentManagementOwner,
} from "./workspace-agent-management.ts";

/** Called only inside the authenticated, freshness/idempotency-checked management transaction. */
export function updateAgentProfile(
  owner: WorkspaceAgentManagementOwner,
  input: ClientAgentProfileRequest,
  requestDigest: string,
) {
  const record = readAgentDefinition(owner.database, input.agentDefinitionId);
  if (record.definition.state === "tombstoned")
    throw new ConflictError("a tombstoned Agent cannot be edited");
  const previous = record.currentRevision;
  if (previous.agentDefinitionRevisionId !== input.expectedRevisionId)
    throw new ConflictError(
      "Agent 资料已在其他页面修改；本次未覆盖。请取消后重新编辑。",
    );
  const {
    agentDefinitionRevisionId: _id,
    revision: _revision,
    contentDigest: _digest,
    createdAt: _createdAt,
    createdBy: _createdBy,
    agentDefinitionId: _agent,
    ...content
  } = previous;
  if (input.field === "description" && input.value === "")
    delete content.description;
  else content[input.field] = input.value;
  const createdAt = owner.now().toISOString();
  const revision = AgentDefinitionRevisionSchema.parse({
    ...content,
    agentDefinitionId: input.agentDefinitionId,
    agentDefinitionRevisionId: owner.createId("agent_definition_revision"),
    revision: previous.revision + 1,
    contentDigest: canonicalDigest(content),
    createdAt,
    createdBy: owner.actorId,
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
    .prepare(
      "UPDATE agent_definitions SET current_revision_id = ?, updated_at = ? WHERE agent_definition_id = ?",
    )
    .run(
      revision.agentDefinitionRevisionId,
      createdAt,
      input.agentDefinitionId,
    );
  const principal = owner.database
    .prepare("SELECT handle FROM principals WHERE principal_id = ?")
    .get(record.definition.participantId)!;
  return owner.events.append({
    actorId: owner.actorId,
    aggregateId: input.agentDefinitionId,
    aggregateType: "agent_definition",
    idempotencyKey: input.idempotencyKey,
    payload: {
      agentDefinitionId: input.agentDefinitionId,
      agentDefinitionRevisionId: revision.agentDefinitionRevisionId,
      agentState: record.definition.state,
      basedOnRoomSeq: input.basedOnRoomSeq,
      field: input.field,
      handle: text(principal, "handle"),
      participantId: record.definition.participantId,
      requestDigest,
    },
    roomId: record.definition.controlRoomId,
    type: "agent.profile_updated",
  });
}
