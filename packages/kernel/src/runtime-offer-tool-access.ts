import type { DatabaseSync } from "node:sqlite";

import {
  RuntimeOfferProjectionSchema,
  type RuntimeOffer,
  type RuntimeOfferProjection,
  type ToolAccessMode,
} from "@rah-os/protocol";

import { ConflictError, NotFoundError } from "./errors.ts";
import { jsonObject, type Row } from "./sqlite-row.ts";
export { currentRuntimeOfferFromRow } from "./runtime-offer-publication.ts";

/**
 * Older durable Offers did not publish this capability. They are compatible
 * only with explicit full access; claiming a restricted mode would be a
 * privilege escalation hidden behind stale metadata.
 */
export function assertRuntimeOfferSupportsToolAccess(
  offer: RuntimeOffer,
  mode: ToolAccessMode,
): void {
  const supported = offer.supportedToolAccessModes ?? ["full_access"];
  if (supported.includes(mode)) return;
  throw new ConflictError(
    `RuntimeOffer ${offer.runtimeOfferId} does not support toolAccessMode ${mode}`,
  );
}

export function runtimeOfferObservationFromId(
  database: DatabaseSync,
  runtimeOfferObservationId: string,
): RuntimeOfferProjection {
  const row = database
    .prepare(
      "SELECT projection_json FROM runtime_offer_observations WHERE runtime_offer_observation_id = ?",
    )
    .get(runtimeOfferObservationId);
  if (row === undefined) {
    throw new NotFoundError(
      `RuntimeOffer observation ${runtimeOfferObservationId} was not found`,
    );
  }
  return RuntimeOfferProjectionSchema.parse(jsonObject(row, "projection_json"));
}

export function runtimeOfferIsAvailable(input: {
  database: DatabaseSync;
  evidenceIsTrusted: (offer: RuntimeOffer) => boolean;
  nowMs: number;
  offerFromRow: (row: Row) => RuntimeOffer;
  runtimeOfferId: string;
}): boolean {
  const row = input.database
    .prepare(
      `SELECT runtime_offers.*
       FROM runtime_offers
       JOIN agent_hosts ON agent_hosts.host_id = runtime_offers.host_id
       WHERE runtime_offers.runtime_offer_id = ?
         AND runtime_offers.lease_until_ms > ?
         AND agent_hosts.state = 'online'
         AND agent_hosts.instance_id = runtime_offers.host_instance_id`,
    )
    .get(input.runtimeOfferId, input.nowMs);
  if (row === undefined) return false;
  const offer = input.offerFromRow(row);
  return (
    offer.state !== "draining" &&
    offer.state !== "unavailable" &&
    input.evidenceIsTrusted(offer)
  );
}
