import type { DatabaseSync } from "node:sqlite";
import { unresolvedActivationCancellation } from "./activation-cancellation.ts";
import { activationProjectionFromRow } from "./delivery-projection.ts";
import { ActivationCancellationRequestedError } from "./errors.ts";
import { text, type Row } from "./sqlite-row.ts";
import { requireAgentExecutionEnabled } from "./workspace-agent-management.ts";

/** Existing renewal transaction tail; caller retains Host/lease/generation gates. */
export function renewValidatedActivationLease(
  database: DatabaseSync,
  row: Row,
  leaseMs: number,
  now: () => Date,
) {
  const cancellation = unresolvedActivationCancellation(database, row);
  if (cancellation !== undefined)
    throw new ActivationCancellationRequestedError(
      text(cancellation, "reason"),
    );
  requireAgentExecutionEnabled(database, text(row, "participant_id"));
  const timestamp = now();
  const leaseUntil = new Date(timestamp.getTime() + leaseMs);
  database
    .prepare(
      "UPDATE activations SET lease_until = ?, lease_until_ms = ?, updated_at = ? WHERE activation_id = ?",
    )
    .run(
      leaseUntil.toISOString(),
      leaseUntil.getTime(),
      timestamp.toISOString(),
      text(row, "activation_id"),
    );
  return activationProjectionFromRow(
    database
      .prepare("SELECT * FROM activations WHERE activation_id=?")
      .get(text(row, "activation_id"))!,
  );
}
