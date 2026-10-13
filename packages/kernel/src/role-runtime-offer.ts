import type { DatabaseSync } from "node:sqlite";
import { currentRuntimeOfferFromRow } from "./runtime-offer-tool-access.ts";
import { NotFoundError } from "./errors.ts";

/** CLI upgrades may replace Offer IDs, but never the exact Host/profile identity. */
export function roleRuntimeOffer(
  db: DatabaseSync,
  offerId: string,
  nowMs: number,
) {
  const row = db
    .prepare("SELECT * FROM runtime_offers WHERE runtime_offer_id=?")
    .get(offerId);
  if (!row) throw new NotFoundError(`RuntimeOffer ${offerId} was not found`);
  const pinned = currentRuntimeOfferFromRow(row);
  const live = (offer: typeof pinned) =>
    offer.state === "available" && Date.parse(offer.leaseUntil) > nowMs;
  return live(pinned)
    ? pinned
    : (db
        .prepare(
          `SELECT * FROM runtime_offers WHERE host_id=? AND runtime_profile_id=? AND runtime_offer_id<>? ORDER BY observed_at_ms DESC`,
        )
        .all(pinned.hostId, pinned.runtimeProfileId, pinned.runtimeOfferId)
        .map(currentRuntimeOfferFromRow)
        .find(live) ?? pinned);
}
