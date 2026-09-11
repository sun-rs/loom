import type { DatabaseSync } from "node:sqlite";
import {
  AgentDefinitionRevisionSchema,
  PlacementDecisionSchema,
  type RuntimeRecoveryDescriptor,
} from "@rah-os/protocol";
import { ConflictError } from "./errors.ts";
import { jsonObject, nullableText, text, type Row } from "./sqlite-row.ts";

export function assertRuntimeWorkspaceProvenance(
  database: DatabaseSync,
  run: Row,
  descriptor: RuntimeRecoveryDescriptor,
): void {
  const placementId = nullableText(run, "placement_id");
  if (placementId === null) {
    if (descriptor.executionWorkspace !== undefined)
      throw new ConflictError(
        "Workspace recovery provenance requires a frozen Placement",
      );
    return;
  }
  const row = database
    .prepare("SELECT decision_json FROM placements WHERE placement_id = ?")
    .get(placementId);
  if (!row) throw new ConflictError("Runtime Placement is missing");
  const placement = PlacementDecisionSchema.parse(
    jsonObject(row, "decision_json"),
  );
  const revisionRow = database
    .prepare(
      "SELECT definition_json FROM agent_definition_revisions WHERE agent_definition_revision_id = ?",
    )
    .get(placement.agentDefinitionRevisionId);
  const revision = revisionRow
    ? AgentDefinitionRevisionSchema.parse(
        jsonObject(revisionRow, "definition_json"),
      )
    : undefined;
  const workspace = descriptor.executionWorkspace;
  if (!workspace) {
    if (revision?.executionWorkspace?.kind === "agent_private")
      throw new ConflictError(
        "Private workspace recovery provenance is required",
      );
    return;
  }
  if (
    workspace.participantId !== text(run, "participant_id") ||
    workspace.participantId !== placement.participantId ||
    workspace.workspaceDefinitionId !== placement.workspaceDefinitionId ||
    workspace.workspaceMountRevisionId !== placement.workspaceMountRevisionId ||
    workspace.workspaceMountDigest !== placement.workspaceMountDigest
  )
    throw new ConflictError(
      "Runtime workspace provenance does not match frozen Placement",
    );
}
