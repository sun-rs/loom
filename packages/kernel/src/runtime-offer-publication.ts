import type { DatabaseSync } from "node:sqlite";

import {
  RuntimeOfferProjectionSchema,
  RuntimeOfferSchema,
  type RuntimeCertification,
  type RuntimeOffer,
  type RuntimeOfferProjection,
} from "@rah-os/protocol";

import type { AuthenticatedHostContext } from "./auth.ts";
import { canonicalDigest } from "./canonical-digest.ts";
import { ConflictError, ForbiddenError } from "./errors.ts";
import {
  integer,
  jsonObject,
  nullableText,
  text,
  type Row,
} from "./sqlite-row.ts";

type RuntimeOfferPublicationOwner = {
  clockSkewMs: number;
  createId: (prefix: string) => string;
  database: DatabaseSync;
  maxTtlMs: number;
  now: () => Date;
  requireAuthenticatedHost: (
    host: AuthenticatedHostContext,
  ) => AuthenticatedHostContext;
  requireRuntimeOfferRow: (runtimeOfferId: string) => Row;
  resolveTrustedEvidence: (offer: RuntimeOffer) => RuntimeCertification[];
  transaction: <T>(operation: () => T) => T;
};

/**
 * Rehydrates the mutable lease envelope around the immutable capability
 * snapshot. Placement provenance keeps using the observation projection.
 */
export function currentRuntimeOfferFromRow(row: Row): RuntimeOfferProjection {
  return RuntimeOfferProjectionSchema.parse({
    ...jsonObject(row, "offer_json"),
    acceptedAt: text(row, "accepted_at"),
    leaseUntil: text(row, "lease_until"),
    observedAt: text(row, "observed_at"),
    state: text(row, "state"),
  });
}

export function compactUnreferencedRuntimeOfferObservations(
  database: DatabaseSync,
  sourceSchemaVersion: number,
): number {
  if (sourceSchemaVersion <= 0 || sourceSchemaVersion >= 43) return 0;
  return Number(
    database
      .prepare(
        `DELETE FROM runtime_offer_observations
       WHERE NOT EXISTS (
         SELECT 1 FROM placements
         WHERE placements.runtime_offer_observation_id =
           runtime_offer_observations.runtime_offer_observation_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM runtime_offers
         WHERE runtime_offers.current_observation_id =
           runtime_offer_observations.runtime_offer_observation_id
       )`,
      )
      .run().changes,
  );
}

/**
 * Accepts one Host lease report. Capability-equivalent heartbeats only renew
 * the mutable head; a changed capability creates a new immutable observation.
 */
export function publishRuntimeOffer(
  owner: RuntimeOfferPublicationOwner,
  host: AuthenticatedHostContext,
  untrustedOffer: RuntimeOffer,
): RuntimeOfferProjection {
  const authenticatedHost = owner.requireAuthenticatedHost(host);
  const reportedOffer = RuntimeOfferSchema.parse(untrustedOffer);
  if (
    reportedOffer.hostId !== authenticatedHost.hostId ||
    reportedOffer.hostInstanceId !== authenticatedHost.instanceId
  ) {
    throw new ForbiddenError(
      "RuntimeOffer must be bound to the authenticated Host generation",
    );
  }
  const resolvedCertifications = owner.resolveTrustedEvidence(reportedOffer);
  const acceptedAt = owner.now();
  const observedAtMs = Date.parse(reportedOffer.observedAt);
  if (observedAtMs > acceptedAt.getTime() + owner.clockSkewMs) {
    throw new ConflictError(
      "RuntimeOffer observedAt is too far in the future of Kernel time",
    );
  }
  const reportedLeaseUntilMs = Date.parse(reportedOffer.leaseUntil);
  if (reportedLeaseUntilMs <= acceptedAt.getTime()) {
    throw new ConflictError("RuntimeOffer lease is already expired");
  }
  const leaseUntilMs = Math.min(
    reportedLeaseUntilMs,
    acceptedAt.getTime() + owner.maxTtlMs,
  );
  const offer = RuntimeOfferSchema.parse({
    ...reportedOffer,
    leaseUntil: new Date(leaseUntilMs).toISOString(),
  });
  const serializedReport = JSON.stringify(reportedOffer);
  return owner.transaction(() => {
    owner.requireAuthenticatedHost(authenticatedHost);
    const existing = owner.database
      .prepare("SELECT * FROM runtime_offers WHERE runtime_offer_id = ?")
      .get(offer.runtimeOfferId);
    if (
      existing !== undefined &&
      (text(existing, "host_id") !== offer.hostId ||
        text(existing, "runtime_profile_id") !== offer.runtimeProfileId ||
        text(existing, "runtime_profile_revision_id") !==
          offer.runtimeProfileRevisionId ||
        text(existing, "revision_digest") !== offer.revisionDigest)
    ) {
      throw new ConflictError(
        `RuntimeOffer ${offer.runtimeOfferId} already belongs to another Host or profile revision`,
      );
    }
    if (existing !== undefined) {
      const existingObservedAtMs = integer(existing, "observed_at_ms");
      if (observedAtMs < existingObservedAtMs) {
        throw new ConflictError(
          `RuntimeOffer ${offer.runtimeOfferId} observation is older than the current observation`,
        );
      }
      if (observedAtMs === existingObservedAtMs) {
        if (
          runtimeOfferReportDigest(currentRuntimeOfferFromRow(existing)) !==
          runtimeOfferReportDigest(offer)
        ) {
          throw new ConflictError(
            `RuntimeOffer ${offer.runtimeOfferId} with the same timestamp has different content`,
          );
        }
        return currentRuntimeOfferFromRow(existing);
      }
    }
    if (existing !== undefined) {
      const currentObservationId = nullableText(
        existing,
        "current_observation_id",
      );
      const currentObservation =
        currentObservationId === null
          ? undefined
          : owner.database
              .prepare(
                "SELECT projection_json FROM runtime_offer_observations WHERE runtime_offer_observation_id = ?",
              )
              .get(currentObservationId);
      if (currentObservation !== undefined) {
        const previousProjection = RuntimeOfferProjectionSchema.parse(
          jsonObject(currentObservation, "projection_json"),
        );
        if (
          runtimeOfferCapabilityDigest(previousProjection) ===
          runtimeOfferCapabilityDigest({
            ...offer,
            acceptedAt: acceptedAt.toISOString(),
            resolvedCertifications,
            runtimeOfferObservationId:
              previousProjection.runtimeOfferObservationId,
            runtimeOfferSnapshotDigest:
              previousProjection.runtimeOfferSnapshotDigest,
          })
        ) {
          const acceptedAtIso = acceptedAt.toISOString();
          owner.database
            .prepare(
              `UPDATE runtime_offers
               SET state = ?, observed_at = ?, observed_at_ms = ?,
                   lease_until = ?, lease_until_ms = ?, accepted_at = ?,
                   updated_at = ?
               WHERE runtime_offer_id = ?`,
            )
            .run(
              offer.state,
              offer.observedAt,
              observedAtMs,
              offer.leaseUntil,
              leaseUntilMs,
              acceptedAtIso,
              acceptedAtIso,
              offer.runtimeOfferId,
            );
          return currentRuntimeOfferFromRow(
            owner.requireRuntimeOfferRow(offer.runtimeOfferId),
          );
        }
      }
    }
    const runtimeOfferObservationId = owner.createId(
      "runtime_offer_observation",
    );
    const previousObservationId =
      existing === undefined
        ? null
        : nullableText(existing, "current_observation_id");
    const previousObservation =
      previousObservationId === null
        ? undefined
        : owner.database
            .prepare(
              "SELECT observation_sequence FROM runtime_offer_observations WHERE runtime_offer_observation_id = ?",
            )
            .get(previousObservationId);
    const observationSequence =
      previousObservation === undefined
        ? 1
        : integer(previousObservation, "observation_sequence") + 1;
    const acceptedAtIso = acceptedAt.toISOString();
    const runtimeOfferSnapshotDigest = canonicalDigest({
      domain: "rah/runtime-offer-snapshot/v1",
      acceptedAt: acceptedAtIso,
      observationSequence,
      offer,
      resolvedCertifications,
    });
    const projection = RuntimeOfferProjectionSchema.parse({
      ...offer,
      acceptedAt: acceptedAtIso,
      resolvedCertifications,
      runtimeOfferObservationId,
      runtimeOfferSnapshotDigest,
    });
    const serializedProjection = JSON.stringify(projection);
    owner.database
      .prepare(
        `INSERT INTO runtime_offer_observations(runtime_offer_observation_id, runtime_offer_id, observation_sequence, runtime_offer_snapshot_digest, host_id, host_instance_id, runtime_profile_revision_id, revision_digest, observed_at, observed_at_ms, accepted_at, accepted_at_ms, lease_until, lease_until_ms, report_json, projection_json)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runtimeOfferObservationId,
        offer.runtimeOfferId,
        observationSequence,
        runtimeOfferSnapshotDigest,
        offer.hostId,
        offer.hostInstanceId,
        offer.runtimeProfileRevisionId,
        offer.revisionDigest,
        offer.observedAt,
        observedAtMs,
        acceptedAtIso,
        acceptedAt.getTime(),
        offer.leaseUntil,
        leaseUntilMs,
        serializedReport,
        serializedProjection,
      );
    const updatedAt = acceptedAtIso;
    owner.database
      .prepare(
        `INSERT INTO runtime_offers(runtime_offer_id, current_observation_id, current_snapshot_digest, host_id, host_instance_id, runtime_profile_id, runtime_profile_revision_id, revision_digest, state, observed_at, observed_at_ms, lease_until, lease_until_ms, accepted_at, offer_json, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(runtime_offer_id) DO UPDATE SET
           current_observation_id = excluded.current_observation_id,
           current_snapshot_digest = excluded.current_snapshot_digest,
           host_id = excluded.host_id,
           host_instance_id = excluded.host_instance_id,
           runtime_profile_id = excluded.runtime_profile_id,
           runtime_profile_revision_id = excluded.runtime_profile_revision_id,
           revision_digest = excluded.revision_digest,
           state = excluded.state,
           observed_at = excluded.observed_at,
           observed_at_ms = excluded.observed_at_ms,
           lease_until = excluded.lease_until,
           lease_until_ms = excluded.lease_until_ms,
           accepted_at = excluded.accepted_at,
           offer_json = excluded.offer_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        offer.runtimeOfferId,
        runtimeOfferObservationId,
        runtimeOfferSnapshotDigest,
        offer.hostId,
        offer.hostInstanceId,
        offer.runtimeProfileId,
        offer.runtimeProfileRevisionId,
        offer.revisionDigest,
        offer.state,
        offer.observedAt,
        observedAtMs,
        offer.leaseUntil,
        leaseUntilMs,
        acceptedAtIso,
        serializedProjection,
        updatedAt,
      );
    return currentRuntimeOfferFromRow(
      owner.requireRuntimeOfferRow(offer.runtimeOfferId),
    );
  });
}

function runtimeOfferReportDigest(
  value: RuntimeOffer | RuntimeOfferProjection,
): string {
  const {
    acceptedAt: _acceptedAt,
    resolvedCertifications: _resolvedCertifications,
    runtimeOfferObservationId: _runtimeOfferObservationId,
    runtimeOfferSnapshotDigest: _runtimeOfferSnapshotDigest,
    ...offer
  } = value as unknown as Record<string, unknown>;
  return canonicalDigest({ domain: "rah/runtime-offer-report/v1", offer });
}

function runtimeOfferCapabilityDigest(value: RuntimeOfferProjection): string {
  const {
    acceptedAt: _acceptedAt,
    leaseUntil: _leaseUntil,
    observedAt: _observedAt,
    runtimeOfferObservationId: _runtimeOfferObservationId,
    runtimeOfferSnapshotDigest: _runtimeOfferSnapshotDigest,
    ...capability
  } = value;
  return canonicalDigest({
    capability,
    domain: "rah/runtime-offer-capability/v1",
  });
}
