import { DatabaseSync } from "node:sqlite";

import {
  PlacementDecisionSchema,
  type ActivationCredentialScope,
  type TaskArtifactReference,
  type TaskSubmissionEvidence,
  type TaskSubmissionRepositoryEvidence,
  type TaskSubmissionWorkspaceEvidence,
  type TaskVerificationDeclaration,
} from "@rah-os/protocol";

import { canonicalDigest } from "./canonical-digest.ts";
import { ExecutionFencedError } from "./errors.ts";

function requiredText(row: Record<string, unknown>, column: string): string {
  const value = row[column];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected non-empty text column ${column}`);
  }
  return value;
}

function optionalText(
  row: Record<string, unknown>,
  column: string,
): string | undefined {
  const value = row[column];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected nullable text column ${column}`);
  }
  return value;
}

export function deriveTaskSubmissionWorkspaceEvidence(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
): TaskSubmissionWorkspaceEvidence {
  const row = database
    .prepare(
      `SELECT run_attempts.host_id, run_attempts.placement_id,
              placements.decision_json
       FROM run_attempts
       LEFT JOIN placements
         ON placements.placement_id = run_attempts.placement_id
       WHERE run_attempts.run_attempt_id = ?`,
    )
    .get(scope.runAttemptId);
  if (row === undefined) {
    throw new ExecutionFencedError(
      `RunAttempt ${scope.runAttemptId} no longer exists`,
    );
  }
  const hostId = requiredText(row, "host_id");
  const placementId = optionalText(row, "placement_id");
  const decisionJson = row.decision_json;
  if (placementId === undefined || typeof decisionJson !== "string") {
    return {
      hostId,
      runAttemptId: scope.runAttemptId,
      source: "run_attempt",
    };
  }
  const decision = PlacementDecisionSchema.parse(JSON.parse(decisionJson));
  if (
    decision.placementId !== placementId ||
    decision.roomId !== scope.roomId ||
    decision.participantId !== scope.participantId
  ) {
    throw new ExecutionFencedError(
      "Task submission Placement evidence does not match the Worker execution",
    );
  }
  return {
    hostId,
    placementId,
    runAttemptId: scope.runAttemptId,
    source: "placement",
    workspaceDefinitionId: decision.workspaceDefinitionId,
    workspaceMode: decision.workspaceMode,
    workspaceMountDigest: decision.workspaceMountDigest,
    workspaceMountRevisionId: decision.workspaceMountRevisionId,
  };
}

export function buildTaskSubmissionEvidence(input: {
  artifacts: TaskArtifactReference[];
  repository: TaskSubmissionRepositoryEvidence | undefined;
  verification: TaskVerificationDeclaration | undefined;
  workspace: TaskSubmissionWorkspaceEvidence;
}): TaskSubmissionEvidence {
  return {
    artifactManifestDigest: canonicalDigest({
      artifacts: input.artifacts,
      domain: "rah/task-artifact-manifest/v1",
    }),
    repository: input.repository ?? {
      reason: "collector_unavailable",
      source: "unavailable",
    },
    schemaVersion: 1,
    verification:
      input.verification === undefined
        ? { source: "not_provided" }
        : { ...input.verification, source: "producer_declared" },
    workspace: input.workspace,
  };
}
