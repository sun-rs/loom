import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { RoomDeletionFileGcSummary } from "@rah-os/protocol";

import { inImmediateTransaction } from "./sqlite-transaction.ts";
import { integer, text } from "./sqlite-row.ts";

const DEFAULT_SWEEP_LIMIT = 50;
const LEASE_MS = 2 * 60_000;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 60 * 60_000;
const TOMBSTONE_REDELETE_MS = [
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
] as const;

export const ROOM_FILE_GC_GLOBAL_CLAIM_SQL = `
  SELECT * FROM room_file_gc_receipts
  WHERE next_attempt_at_ms <= ?
    AND (
      state IN ('pending','failed')
      OR (
        state IN ('deleting','tombstoned')
        AND (lease_expires_at_ms IS NULL OR lease_expires_at_ms <= ?)
      )
    )
  ORDER BY next_attempt_at_ms,created_at,deletion_id,attachment_id
  LIMIT 1
`;

export const ROOM_FILE_GC_SCOPED_CLAIM_SQL = `
  SELECT * FROM room_file_gc_receipts
  WHERE deletion_id=?
    AND next_attempt_at_ms <= ?
    AND (
      state IN ('pending','failed')
      OR (
        state IN ('deleting','tombstoned')
        AND (lease_expires_at_ms IS NULL OR lease_expires_at_ms <= ?)
      )
    )
  ORDER BY next_attempt_at_ms,created_at,attachment_id
  LIMIT 1
`;

export type RoomFileGcReconcileResult = Readonly<{
  attempted: number;
  failed: number;
  outstandingFailures: number;
  reclaimed: number;
  remainingDue: number;
}>;

type ClaimedGcRow = Readonly<{
  attachmentId: string;
  attemptCount: number;
  deletionId: string;
  leaseToken: string;
  state: "deleting" | "tombstoned";
  tombstonePass: number;
}>;

/**
 * Durable post-Room-deletion file reconciler.
 *
 * Structural port of Multica's one-row claim, lease, capped exponential
 * backoff, post-claim reference check, and widening tombstone re-delete
 * schedule. SQLite replaces PostgreSQL SKIP LOCKED because one local Room
 * Kernel serializes claims with BEGIN IMMEDIATE.
 */
export class RoomFileGcService {
  readonly #database: DatabaseSync;
  readonly #now: () => Date;
  readonly #reclaimBlob: (attachmentId: string) => void;

  constructor(input: {
    database: DatabaseSync;
    now: () => Date;
    reclaimBlob: (attachmentId: string) => void;
  }) {
    this.#database = input.database;
    this.#now = input.now;
    this.#reclaimBlob = input.reclaimBlob;
  }

  initialize(): RoomFileGcReconcileResult {
    this.#migrateSchemaV42();
    return this.reconcile({ limit: DEFAULT_SWEEP_LIMIT });
  }

  reconcile(
    input: Readonly<{ deletionId?: string; limit?: number }> = {},
  ): RoomFileGcReconcileResult {
    const limit = input.limit ?? DEFAULT_SWEEP_LIMIT;
    if (!Number.isInteger(limit) || limit <= 0 || limit > 1_000) {
      throw new Error(
        "Room file GC limit must be an integer between 1 and 1000",
      );
    }

    let attempted = 0;
    let failed = 0;
    let reclaimed = 0;
    for (; attempted < limit; attempted += 1) {
      const claimed = this.#claimNext(input.deletionId);
      if (claimed === undefined) break;
      if (this.#isReferenced(claimed.attachmentId)) {
        failed += 1;
        this.#release(
          claimed,
          new Error(
            "Room deletion GC attachment is still referenced by canonical room_files",
          ),
        );
        continue;
      }
      try {
        this.#reclaimBlob(claimed.attachmentId);
      } catch (error) {
        failed += 1;
        this.#release(claimed, error);
        continue;
      }
      if (this.#recordSuccessfulDelete(claimed)) reclaimed += 1;
    }

    return {
      attempted,
      failed,
      outstandingFailures: this.#outstandingFailureCount(input.deletionId),
      reclaimed,
      remainingDue: this.#dueCount(input.deletionId),
    };
  }

  summary(deletionId: string): RoomDeletionFileGcSummary {
    const counts = this.#database
      .prepare(
        `SELECT
           receipt.file_count AS total,
           receipt.gc_reclaimed_count + SUM(CASE
             WHEN gc.last_error IS NULL AND gc.state IN ('tombstoned','reclaimed')
             THEN 1 ELSE 0
           END) AS reclaimed,
           SUM(CASE
             WHEN gc.last_error IS NOT NULL THEN 1 ELSE 0
           END) AS failed,
           receipt.file_count - receipt.gc_reclaimed_count - SUM(CASE
             WHEN gc.last_error IS NULL AND gc.state IN ('tombstoned','reclaimed')
             THEN 1 ELSE 0
           END) - SUM(CASE
             WHEN gc.last_error IS NOT NULL THEN 1 ELSE 0
           END) AS pending
         FROM room_deletion_receipts AS receipt
         LEFT JOIN room_file_gc_receipts AS gc
           ON gc.deletion_id=receipt.deletion_id
         WHERE receipt.deletion_id=?
         GROUP BY receipt.deletion_id,receipt.file_count,receipt.gc_reclaimed_count`,
      )
      .get(deletionId);
    return {
      failed: Number(counts?.failed ?? 0),
      pending: Number(counts?.pending ?? 0),
      reclaimed: Number(counts?.reclaimed ?? 0),
      total: Number(counts?.total ?? 0),
    };
  }

  #claimNext(deletionId: string | undefined): ClaimedGcRow | undefined {
    return inImmediateTransaction(this.#database, () => {
      const nowMs = this.#now().getTime();
      const row =
        deletionId === undefined
          ? this.#database
              .prepare(ROOM_FILE_GC_GLOBAL_CLAIM_SQL)
              .get(nowMs, nowMs)
          : this.#database
              .prepare(ROOM_FILE_GC_SCOPED_CLAIM_SQL)
              .get(deletionId, nowMs, nowMs);
      if (row === undefined) return undefined;

      const leaseToken = randomUUID();
      const state =
        text(row, "state") === "tombstoned" ? "tombstoned" : "deleting";
      this.#database
        .prepare(
          `UPDATE room_file_gc_receipts
           SET state=?,attempt_count=attempt_count+1,lease_token=?,
               lease_expires_at_ms=?,updated_at=?
           WHERE deletion_id=? AND attachment_id=?`,
        )
        .run(
          state,
          leaseToken,
          nowMs + LEASE_MS,
          this.#now().toISOString(),
          text(row, "deletion_id"),
          text(row, "attachment_id"),
        );
      return {
        attachmentId: text(row, "attachment_id"),
        attemptCount: integer(row, "attempt_count") + 1,
        deletionId: text(row, "deletion_id"),
        leaseToken,
        state,
        tombstonePass: integer(row, "tombstone_pass"),
      };
    });
  }

  #isReferenced(attachmentId: string): boolean {
    return (
      this.#database
        .prepare(
          "SELECT 1 AS referenced FROM room_files WHERE attachment_id=? LIMIT 1",
        )
        .get(attachmentId) !== undefined
    );
  }

  #release(claimed: ClaimedGcRow, cause: unknown): void {
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
        `UPDATE room_file_gc_receipts
         SET lease_token=NULL,lease_expires_at_ms=NULL,next_attempt_at_ms=?,
             last_error=?,updated_at=?
         WHERE deletion_id=? AND attachment_id=? AND lease_token=?`,
      )
      .run(
        now.getTime() + backoffMs,
        message,
        now.toISOString(),
        claimed.deletionId,
        claimed.attachmentId,
        claimed.leaseToken,
      );
  }

  #recordSuccessfulDelete(claimed: ClaimedGcRow): boolean {
    const nextPass =
      claimed.state === "tombstoned" ? claimed.tombstonePass + 1 : 0;
    const now = this.#now();
    if (nextPass < TOMBSTONE_REDELETE_MS.length) {
      const result = this.#database
        .prepare(
          `UPDATE room_file_gc_receipts
           SET state='tombstoned',lease_token=NULL,lease_expires_at_ms=NULL,
               next_attempt_at_ms=?,tombstone_pass=?,last_error=NULL,updated_at=?
           WHERE deletion_id=? AND attachment_id=? AND lease_token=?`,
        )
        .run(
          now.getTime() + TOMBSTONE_REDELETE_MS[nextPass]!,
          nextPass,
          now.toISOString(),
          claimed.deletionId,
          claimed.attachmentId,
          claimed.leaseToken,
        );
      return Number(result.changes) === 1;
    }
    return inImmediateTransaction(this.#database, () => {
      const removed = this.#database
        .prepare(
          `DELETE FROM room_file_gc_receipts
           WHERE deletion_id=? AND attachment_id=? AND lease_token=?`,
        )
        .run(claimed.deletionId, claimed.attachmentId, claimed.leaseToken);
      if (Number(removed.changes) !== 1) return false;
      const summarized = this.#database
        .prepare(
          `UPDATE room_deletion_receipts
           SET gc_reclaimed_count=gc_reclaimed_count+1
           WHERE deletion_id=? AND gc_reclaimed_count < file_count`,
        )
        .run(claimed.deletionId);
      if (Number(summarized.changes) !== 1) {
        throw new Error(
          `Room file GC summary overflow for deletion ${claimed.deletionId}`,
        );
      }
      return true;
    });
  }

  #dueCount(deletionId: string | undefined): number {
    const nowMs = this.#now().getTime();
    const predicate = `
      next_attempt_at_ms <= ?
      AND (
        state IN ('pending','failed')
        OR (
          state IN ('deleting','tombstoned')
          AND (lease_expires_at_ms IS NULL OR lease_expires_at_ms <= ?)
        )
      )`;
    const row =
      deletionId === undefined
        ? this.#database
            .prepare(
              `SELECT COUNT(*) AS count FROM room_file_gc_receipts WHERE ${predicate}`,
            )
            .get(nowMs, nowMs)
        : this.#database
            .prepare(
              `SELECT COUNT(*) AS count FROM room_file_gc_receipts
               WHERE deletion_id=? AND ${predicate}`,
            )
            .get(deletionId, nowMs, nowMs);
    return Number(row?.count ?? 0);
  }

  #outstandingFailureCount(deletionId: string | undefined): number {
    const row =
      deletionId === undefined
        ? this.#database
            .prepare(
              `SELECT COUNT(*) AS count FROM room_file_gc_receipts
               WHERE last_error IS NOT NULL`,
            )
            .get()
        : this.#database
            .prepare(
              `SELECT COUNT(*) AS count FROM room_file_gc_receipts
               WHERE deletion_id=? AND last_error IS NOT NULL`,
            )
            .get(deletionId);
    return Number(row?.count ?? 0);
  }

  #migrateSchemaV42(): void {
    const deletionColumns = this.#database
      .prepare("PRAGMA table_info(room_deletion_receipts)")
      .all();
    if (
      !deletionColumns.some((row) => text(row, "name") === "gc_reclaimed_count")
    ) {
      this.#database.exec(
        "ALTER TABLE room_deletion_receipts ADD COLUMN gc_reclaimed_count INTEGER NOT NULL DEFAULT 0",
      );
    }
    const columns = this.#database
      .prepare("PRAGMA table_info(room_file_gc_receipts)")
      .all();
    if (columns.some((row) => text(row, "name") === "next_attempt_at_ms")) {
      this.#compactLegacyReclaimedRows();
      this.#ensurePerformanceIndexes();
      return;
    }

    const now = this.#now();
    this.#database.exec("PRAGMA foreign_keys = OFF");
    try {
      this.#database.exec("BEGIN IMMEDIATE");
      this.#database.exec(`
        DROP INDEX IF EXISTS idx_room_file_gc_pending;
        ALTER TABLE room_file_gc_receipts RENAME TO room_file_gc_receipts_v40;
        CREATE TABLE room_file_gc_receipts (
          deletion_id TEXT NOT NULL REFERENCES room_deletion_receipts(deletion_id),
          attachment_id TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('pending','deleting','tombstoned','reclaimed','failed')),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          next_attempt_at_ms INTEGER NOT NULL,
          lease_token TEXT,
          lease_expires_at_ms INTEGER,
          tombstone_pass INTEGER NOT NULL DEFAULT -1 CHECK (tombstone_pass >= -1),
          PRIMARY KEY (deletion_id, attachment_id),
          UNIQUE (attachment_id),
          CHECK (next_attempt_at_ms >= 0),
          CHECK (
            (lease_token IS NULL AND lease_expires_at_ms IS NULL)
            OR (lease_token IS NOT NULL AND lease_expires_at_ms IS NOT NULL)
          )
        ) STRICT;
      `);
      this.#database
        .prepare(
          `INSERT INTO room_file_gc_receipts(
             deletion_id,attachment_id,state,attempt_count,last_error,
             created_at,updated_at,next_attempt_at_ms,lease_token,
             lease_expires_at_ms,tombstone_pass
           )
           SELECT deletion_id,attachment_id,state,attempt_count,last_error,
                  created_at,updated_at,?,NULL,NULL,-1
           FROM room_file_gc_receipts_v40`,
        )
        .run(now.getTime());
      this.#database.exec(`
        DROP TABLE room_file_gc_receipts_v40;
        CREATE INDEX idx_room_file_gc_pending
          ON room_file_gc_receipts(
            next_attempt_at_ms,created_at,deletion_id,attachment_id,state,lease_expires_at_ms
          );
        CREATE INDEX idx_room_file_gc_scoped_due
          ON room_file_gc_receipts(
            deletion_id,next_attempt_at_ms,created_at,attachment_id,state,lease_expires_at_ms
          );
        CREATE INDEX idx_room_file_gc_failures
          ON room_file_gc_receipts(deletion_id)
          WHERE last_error IS NOT NULL;
      `);
      const violations = this.#database
        .prepare("PRAGMA foreign_key_check")
        .all();
      if (violations.length > 0) {
        throw new Error(
          `Room file GC schema migration left ${violations.length} foreign-key violation(s)`,
        );
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      if (this.#database.isTransaction) this.#database.exec("ROLLBACK");
      throw error;
    } finally {
      this.#database.exec("PRAGMA foreign_keys = ON");
    }
    this.#compactLegacyReclaimedRows();
  }

  #ensurePerformanceIndexes(): void {
    const expected = [
      "next_attempt_at_ms",
      "created_at",
      "deletion_id",
      "attachment_id",
      "state",
      "lease_expires_at_ms",
    ];
    const current = this.#database
      .prepare("PRAGMA index_info(idx_room_file_gc_pending)")
      .all()
      .map((row) => text(row, "name"));
    inImmediateTransaction(this.#database, () => {
      if (
        current.length !== expected.length ||
        current.some((column, index) => column !== expected[index])
      ) {
        this.#database.exec("DROP INDEX IF EXISTS idx_room_file_gc_pending");
        this.#database.exec(`
          CREATE INDEX idx_room_file_gc_pending
            ON room_file_gc_receipts(
              next_attempt_at_ms,created_at,deletion_id,attachment_id,state,lease_expires_at_ms
            )
        `);
      }
      this.#database.exec(`
        CREATE INDEX IF NOT EXISTS idx_room_file_gc_scoped_due
          ON room_file_gc_receipts(
            deletion_id,next_attempt_at_ms,created_at,attachment_id,state,lease_expires_at_ms
          );
        CREATE INDEX IF NOT EXISTS idx_room_file_gc_failures
          ON room_file_gc_receipts(deletion_id)
          WHERE last_error IS NOT NULL;
      `);
    });
  }

  #compactLegacyReclaimedRows(): void {
    inImmediateTransaction(this.#database, () => {
      const rows = this.#database
        .prepare(
          `SELECT deletion_id,COUNT(*) AS count
           FROM room_file_gc_receipts
           WHERE state='reclaimed'
           GROUP BY deletion_id`,
        )
        .all();
      for (const row of rows) {
        const deletionId = text(row, "deletion_id");
        const count = integer(row, "count");
        const receipt = this.#database
          .prepare(
            `SELECT file_count,gc_reclaimed_count
             FROM room_deletion_receipts WHERE deletion_id=?`,
          )
          .get(deletionId);
        if (
          receipt === undefined ||
          integer(receipt, "gc_reclaimed_count") + count >
            integer(receipt, "file_count")
        ) {
          throw new Error(
            `Room file GC legacy summary overflow for deletion ${deletionId}`,
          );
        }
        this.#database
          .prepare(
            `UPDATE room_deletion_receipts
             SET gc_reclaimed_count=gc_reclaimed_count+?
             WHERE deletion_id=?`,
          )
          .run(count, deletionId);
        this.#database
          .prepare(
            `DELETE FROM room_file_gc_receipts
             WHERE deletion_id=? AND state='reclaimed'`,
          )
          .run(deletionId);
      }
    });
  }
}
