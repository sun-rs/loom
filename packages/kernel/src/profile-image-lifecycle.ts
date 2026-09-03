import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  UploadedProfileImageKeySchema,
  isUploadedProfileImageKey,
} from "@rah-os/protocol";

import type { AuthenticatedActorContext } from "./auth.ts";
import { ConflictError } from "./errors.ts";
import { inImmediateTransaction } from "./sqlite-transaction.ts";
import { integer, nullableInteger, text } from "./sqlite-row.ts";

const DEFAULT_SWEEP_LIMIT = 50;
const SETTLE_MS = 15 * 60_000;
const LEASE_MS = 2 * 60_000;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 60 * 60_000;
const TOMBSTONE_REDELETE_MS = [
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
] as const;

const PROFILE_IMAGE_REFERENCE_SQL = `
  SELECT 1 AS referenced FROM principals WHERE avatar_key=?
  UNION ALL
  SELECT 1 FROM workspaces WHERE avatar_key=?
  UNION ALL
  SELECT 1 FROM agent_definition_revisions
    WHERE json_extract(definition_json, '$.avatarKey')=?
  UNION ALL
  SELECT 1 FROM messages
  JOIN json_tree(
    CASE WHEN json_valid(messages.forwarded_bundle_json)
      THEN messages.forwarded_bundle_json ELSE NULL END,
    '$.items'
  ) AS forwarded_avatar
    ON forwarded_avatar.key='avatarKey' AND forwarded_avatar.value=?
  LIMIT 1
`;

export type ProfileImageInventoryEntry = Readonly<{
  avatarKey: string;
  modifiedAtMs: number;
}>;

export type ProfileImageGcReconcileResult = Readonly<{
  attempted: number;
  failed: number;
  reclaimed: number;
  remainingDue: number;
}>;

type ClaimedProfileImage = Readonly<{
  attemptCount: number;
  avatarKey: string;
  leaseToken: string;
  state: "deleting" | "tombstoned";
  tombstonePass: number;
}>;

/**
 * Durable profile-image upload-intent and GC owner.
 *
 * Raft exposes upload-and-bind as one product operation. RAH OS keeps its
 * existing local content endpoint, so a short-lived intent receipt closes the
 * upload/save crash window. Claim fencing, leases, backoff, post-claim
 * reference checks and tombstone re-deletes structurally follow Multica's
 * media reconciler while remaining SQLite-local.
 */
export class ProfileImageLifecycleService {
  readonly #createId: (prefix: string) => string;
  readonly #database: DatabaseSync;
  readonly #now: () => Date;
  readonly #requireActor: (actor: AuthenticatedActorContext) => string;

  constructor(input: {
    createId?: (prefix: string) => string;
    database: DatabaseSync;
    now: () => Date;
    requireActor: (actor: AuthenticatedActorContext) => string;
  }) {
    this.#createId =
      input.createId ?? ((prefix) => `${prefix}_${randomUUID()}`);
    this.#database = input.database;
    this.#now = input.now;
    this.#requireActor = input.requireActor;
  }

  recordUpload(
    actor: AuthenticatedActorContext,
    input: Readonly<{ avatarKey: string }>,
  ): Readonly<{ uploadIntentId: string }> {
    const actorId = this.#requireActor(actor);
    const avatarKey = UploadedProfileImageKeySchema.parse(input.avatarKey);
    return inImmediateTransaction(this.#database, () => {
      const now = this.#now();
      const current = this.#database
        .prepare("SELECT * FROM profile_image_objects WHERE avatar_key=?")
        .get(avatarKey);
      if (current === undefined) {
        this.#database
          .prepare(
            `INSERT INTO profile_image_objects(
               avatar_key,state,created_at,updated_at,next_attempt_at_ms
             ) VALUES(?, 'pending', ?, ?, ?)`,
          )
          .run(
            avatarKey,
            now.toISOString(),
            now.toISOString(),
            now.getTime() + SETTLE_MS,
          );
      } else {
        const state = text(current, "state");
        const leaseExpiresAtMs = nullableInteger(
          current,
          "lease_expires_at_ms",
        );
        if (
          state === "deleting" ||
          (state === "tombstoned" &&
            leaseExpiresAtMs !== null &&
            leaseExpiresAtMs > now.getTime())
        ) {
          throw new ConflictError(
            "profile image is being reclaimed; upload it again after recovery",
          );
        }
        this.#database
          .prepare(
            `UPDATE profile_image_objects
             SET state='pending',updated_at=?,next_attempt_at_ms=?,
                 lease_token=NULL,lease_expires_at_ms=NULL,last_error=NULL,
                 tombstone_pass=-1
             WHERE avatar_key=?`,
          )
          .run(now.toISOString(), now.getTime() + SETTLE_MS, avatarKey);
      }
      const uploadIntentId = this.#createId("profile_image_upload_intent");
      this.#database
        .prepare(
          `INSERT INTO profile_image_upload_intents(
             upload_intent_id,avatar_key,actor_id,created_at,created_at_ms
           ) VALUES(?, ?, ?, ?, ?)`,
        )
        .run(
          uploadIntentId,
          avatarKey,
          actorId,
          now.toISOString(),
          now.getTime(),
        );
      return { uploadIntentId };
    });
  }

  /** Must be called inside the same Kernel transaction as the profile write. */
  bindReference(
    actorId: string,
    avatarKey: string | null | undefined,
    uploadIntentId?: string,
  ): void {
    if (!isUploadedProfileImageKey(avatarKey ?? undefined)) return;
    const canonicalAvatarKey = UploadedProfileImageKeySchema.parse(avatarKey);
    if (uploadIntentId === undefined) {
      if (this.#isReferenced(canonicalAvatarKey)) return;
      throw new ConflictError(
        "a new uploaded profile image requires its upload intent",
      );
    }
    const intent = this.#database
      .prepare(
        `SELECT intent.upload_intent_id
         FROM profile_image_upload_intents AS intent
         JOIN profile_image_objects AS object
           ON object.avatar_key=intent.avatar_key
         WHERE intent.upload_intent_id=? AND intent.avatar_key=?
           AND intent.actor_id=? AND object.state='pending'`,
      )
      .get(uploadIntentId, canonicalAvatarKey, actorId);
    if (intent === undefined) {
      if (this.#isReferenced(canonicalAvatarKey)) return;
      throw new ConflictError(
        "profile image upload intent is invalid or no longer pending",
      );
    }
    this.#database
      .prepare(
        "DELETE FROM profile_image_upload_intents WHERE upload_intent_id=?",
      )
      .run(uploadIntentId);
  }

  /** Must be called inside the same Kernel transaction as the profile write. */
  releaseReference(
    previousAvatarKey: string | null | undefined,
    nextAvatarKey: string | null | undefined,
  ): void {
    if (
      previousAvatarKey === nextAvatarKey ||
      !isUploadedProfileImageKey(previousAvatarKey ?? undefined)
    ) {
      return;
    }
    const canonicalPreviousAvatarKey =
      UploadedProfileImageKeySchema.parse(previousAvatarKey);
    const now = this.#now();
    this.#database
      .prepare(
        `INSERT INTO profile_image_objects(
           avatar_key,state,created_at,updated_at,next_attempt_at_ms
         ) VALUES(?, 'pending', ?, ?, ?)
         ON CONFLICT(avatar_key) DO UPDATE SET
           next_attempt_at_ms=CASE
             WHEN profile_image_objects.state='pending'
             THEN MAX(profile_image_objects.next_attempt_at_ms, excluded.next_attempt_at_ms)
             ELSE profile_image_objects.next_attempt_at_ms
           END,
           updated_at=excluded.updated_at`,
      )
      .run(
        canonicalPreviousAvatarKey,
        now.toISOString(),
        now.toISOString(),
        now.getTime() + SETTLE_MS,
      );
  }

  registerInventory(entries: readonly ProfileImageInventoryEntry[]): void {
    inImmediateTransaction(this.#database, () => {
      const findReference = this.#database.prepare(PROFILE_IMAGE_REFERENCE_SQL);
      const insertObject = this.#database.prepare(
        `INSERT OR IGNORE INTO profile_image_objects(
           avatar_key,state,created_at,updated_at,next_attempt_at_ms
         ) VALUES(?, 'pending', ?, ?, ?)`,
      );
      for (const entry of entries) {
        const avatarKey = UploadedProfileImageKeySchema.parse(entry.avatarKey);
        if (
          !Number.isSafeInteger(entry.modifiedAtMs) ||
          entry.modifiedAtMs < 0
        ) {
          throw new Error("profile image inventory timestamp is invalid");
        }
        if (
          findReference.get(avatarKey, avatarKey, avatarKey, avatarKey) !==
          undefined
        ) {
          continue;
        }
        const createdAt = new Date(entry.modifiedAtMs).toISOString();
        insertObject.run(
          avatarKey,
          createdAt,
          this.#now().toISOString(),
          entry.modifiedAtMs + SETTLE_MS,
        );
      }
    });
  }

  reconcile(input: {
    limit?: number;
    reclaimBlob: (avatarKey: string) => void;
  }): ProfileImageGcReconcileResult {
    const limit = input.limit ?? DEFAULT_SWEEP_LIMIT;
    if (!Number.isInteger(limit) || limit <= 0 || limit > 1_000) {
      throw new Error(
        "profile image GC limit must be an integer between 1 and 1000",
      );
    }
    let attempted = 0;
    let failed = 0;
    let reclaimed = 0;
    for (; attempted < limit; attempted += 1) {
      const claimed = this.#claimNext();
      if (claimed === undefined) break;
      if (this.#isReferenced(claimed.avatarKey)) {
        this.#clearReferenced(claimed);
        continue;
      }
      try {
        input.reclaimBlob(claimed.avatarKey);
      } catch (error) {
        failed += 1;
        this.#releaseClaim(claimed, error);
        continue;
      }
      if (this.#recordSuccessfulDelete(claimed)) reclaimed += 1;
    }
    return {
      attempted,
      failed,
      reclaimed,
      remainingDue: this.#dueCount(),
    };
  }

  #claimNext(): ClaimedProfileImage | undefined {
    return inImmediateTransaction(this.#database, () => {
      const now = this.#now();
      this.#database
        .prepare(
          "DELETE FROM profile_image_upload_intents WHERE created_at_ms <= ?",
        )
        .run(now.getTime() - SETTLE_MS);
      const row = this.#database
        .prepare(
          `SELECT * FROM profile_image_objects AS object
           WHERE object.next_attempt_at_ms <= ?
             AND NOT EXISTS (
               SELECT 1 FROM profile_image_upload_intents AS intent
               WHERE intent.avatar_key=object.avatar_key
             )
             AND (
               object.state='pending'
               OR (
                 object.state IN ('deleting','tombstoned')
                 AND (
                   object.lease_expires_at_ms IS NULL
                   OR object.lease_expires_at_ms <= ?
                 )
               )
             )
           ORDER BY object.next_attempt_at_ms,object.created_at,object.avatar_key
           LIMIT 1`,
        )
        .get(now.getTime(), now.getTime());
      if (row === undefined) return undefined;
      const leaseToken = randomUUID();
      const state =
        text(row, "state") === "tombstoned" ? "tombstoned" : "deleting";
      this.#database
        .prepare(
          `UPDATE profile_image_objects
           SET state=?,attempt_count=attempt_count+1,lease_token=?,
               lease_expires_at_ms=?,updated_at=?
           WHERE avatar_key=?`,
        )
        .run(
          state,
          leaseToken,
          now.getTime() + LEASE_MS,
          now.toISOString(),
          text(row, "avatar_key"),
        );
      return {
        attemptCount: integer(row, "attempt_count") + 1,
        avatarKey: text(row, "avatar_key"),
        leaseToken,
        state,
        tombstonePass: integer(row, "tombstone_pass"),
      };
    });
  }

  #isReferenced(avatarKey: string): boolean {
    return (
      this.#database
        .prepare(PROFILE_IMAGE_REFERENCE_SQL)
        .get(avatarKey, avatarKey, avatarKey, avatarKey) !== undefined
    );
  }

  #clearReferenced(claimed: ClaimedProfileImage): void {
    inImmediateTransaction(this.#database, () => {
      this.#database
        .prepare("DELETE FROM profile_image_upload_intents WHERE avatar_key=?")
        .run(claimed.avatarKey);
      this.#database
        .prepare(
          "DELETE FROM profile_image_objects WHERE avatar_key=? AND lease_token=?",
        )
        .run(claimed.avatarKey, claimed.leaseToken);
    });
  }

  #releaseClaim(claimed: ClaimedProfileImage, cause: unknown): void {
    const backoffMs = Math.min(
      BACKOFF_BASE_MS * 2 ** Math.min(claimed.attemptCount - 1, 10),
      BACKOFF_CAP_MS,
    );
    const message = (
      cause instanceof Error ? cause.message : String(cause)
    ).slice(0, 2_000);
    const now = this.#now();
    this.#database
      .prepare(
        `UPDATE profile_image_objects
         SET lease_token=NULL,lease_expires_at_ms=NULL,next_attempt_at_ms=?,
             last_error=?,updated_at=?
         WHERE avatar_key=? AND lease_token=?`,
      )
      .run(
        now.getTime() + backoffMs,
        message,
        now.toISOString(),
        claimed.avatarKey,
        claimed.leaseToken,
      );
  }

  #recordSuccessfulDelete(claimed: ClaimedProfileImage): boolean {
    const nextPass =
      claimed.state === "tombstoned" ? claimed.tombstonePass + 1 : 0;
    const now = this.#now();
    if (nextPass < TOMBSTONE_REDELETE_MS.length) {
      const result = this.#database
        .prepare(
          `UPDATE profile_image_objects
           SET state='tombstoned',lease_token=NULL,lease_expires_at_ms=NULL,
               next_attempt_at_ms=?,tombstone_pass=?,last_error=NULL,updated_at=?
           WHERE avatar_key=? AND lease_token=?`,
        )
        .run(
          now.getTime() + TOMBSTONE_REDELETE_MS[nextPass]!,
          nextPass,
          now.toISOString(),
          claimed.avatarKey,
          claimed.leaseToken,
        );
      return Number(result.changes) === 1;
    }
    const result = this.#database
      .prepare(
        "DELETE FROM profile_image_objects WHERE avatar_key=? AND lease_token=?",
      )
      .run(claimed.avatarKey, claimed.leaseToken);
    return Number(result.changes) === 1;
  }

  #dueCount(): number {
    const nowMs = this.#now().getTime();
    const row = this.#database
      .prepare(
        `SELECT COUNT(*) AS count FROM profile_image_objects AS object
         WHERE object.next_attempt_at_ms <= ?
           AND NOT EXISTS (
             SELECT 1 FROM profile_image_upload_intents AS intent
             WHERE intent.avatar_key=object.avatar_key
           )
           AND (
             object.state='pending'
             OR (
               object.state IN ('deleting','tombstoned')
               AND (
                 object.lease_expires_at_ms IS NULL
                 OR object.lease_expires_at_ms <= ?
               )
             )
           )`,
      )
      .get(nowMs, nowMs);
    return row === undefined ? 0 : integer(row, "count");
  }
}
