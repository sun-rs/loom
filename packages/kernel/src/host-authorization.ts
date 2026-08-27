import type { DatabaseSync } from "node:sqlite";

import type { AuthenticatedHostContext } from "./auth.ts";
import { UnauthenticatedError } from "./errors.ts";
import { stringArray, text } from "./sqlite-row.ts";

export function authorizedHostParticipantIds(
  database: DatabaseSync,
  host: AuthenticatedHostContext,
): string[] {
  const row = database
    .prepare(
      "SELECT host_id, participant_ids_json FROM agent_host_credentials WHERE credential_id = ? AND revoked_at IS NULL",
    )
    .get(host.credentialId);
  if (row === undefined || text(row, "host_id") !== host.hostId) {
    throw new UnauthenticatedError("host authentication context is invalid");
  }
  return stringArray(row, "participant_ids_json");
}
