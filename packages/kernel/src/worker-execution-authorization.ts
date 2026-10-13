import type { DatabaseSync } from "node:sqlite";
import {
  ActivationCredentialScopeSchema,
  type ActivationCredentialScope,
} from "@rah-os/protocol";
import {
  isIssuedWorkerExecutionContext,
  type AuthenticatedWorkerExecutionContext,
} from "./auth.ts";
import { UnauthenticatedError } from "./errors.ts";
import { nullableText, text, stringArray } from "./sqlite-row.ts";
import { requireSideCapability } from "./side-session.ts";

export function requireWorkerExecution(
  database: DatabaseSync,
  execution: AuthenticatedWorkerExecutionContext,
  assertScope: (scope: ActivationCredentialScope) => void,
  conversation = false,
): ActivationCredentialScope {
  if (!isIssuedWorkerExecutionContext(execution)) {
    throw new UnauthenticatedError("worker execution context is invalid");
  }
  const scope = ActivationCredentialScopeSchema.parse(execution.scope);
  const instance = database
    .prepare(
      "SELECT credential_id, instance_id, state FROM agent_hosts WHERE host_id = ?",
    )
    .get(scope.hostId);
  if (
    !instance ||
    nullableText(instance, "credential_id") !== execution.hostCredentialId ||
    text(instance, "instance_id") !== execution.hostInstanceId ||
    text(instance, "state") === "offline"
  ) {
    throw new UnauthenticatedError("worker execution context is invalid");
  }
  const row = database
    .prepare(
      "SELECT host_id, participant_ids_json FROM agent_host_credentials WHERE credential_id = ? AND revoked_at IS NULL",
    )
    .get(execution.hostCredentialId);
  if (
    !row ||
    text(row, "host_id") !== scope.hostId ||
    !stringArray(row, "participant_ids_json").includes(scope.participantId)
  ) {
    throw new UnauthenticatedError("worker execution context is invalid");
  }
  assertScope(scope);
  requireSideCapability(database, scope, conversation);
  return scope;
}
