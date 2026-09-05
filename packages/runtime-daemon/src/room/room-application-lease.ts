import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  canonicalizeRoomRoot,
  roomRootLeaseIdentities,
} from "./room-storage-path";

const SQLITE_BUSY = 5;

type HeldLease = {
  database: DatabaseSync;
  leasePath: string;
};

function leasePathForIdentity(identity: string): string {
  const hash = createHash("sha256")
    .update(identity, "utf8")
    .digest("hex")
    .slice(0, 40);
  const leaseRoot = path.join(path.dirname(identity), ".rah-room-locks");
  mkdirSync(leaseRoot, { recursive: true, mode: 0o700 });
  chmodSync(leaseRoot, 0o700);
  return path.join(leaseRoot, `${hash}.sqlite`);
}

function internalLeasePath(roomRoot: string): string {
  mkdirSync(roomRoot, { recursive: true, mode: 0o700 });
  chmodSync(roomRoot, 0o700);
  return path.join(canonicalizeRoomRoot(roomRoot), ".rah-room-owner.sqlite");
}

function isSqliteBusy(error: unknown): boolean {
  const errcode = (error as { errcode?: unknown } | null)?.errcode;
  return typeof errcode === "number" && (errcode & 0xff) === SQLITE_BUSY;
}

function closeHeldLease(held: HeldLease): unknown[] {
  const errors: unknown[] = [];
  try {
    held.database.exec("ROLLBACK");
  } catch (error) {
    errors.push(error);
  }
  try {
    held.database.close();
  } catch (error) {
    errors.push(error);
  }
  return errors;
}

/**
 * Cross-process exclusion for every application port and offline Room operation.
 *
 * Each owner holds stable-location and current-physical-path leases outside the
 * data root, then an internal lease that moves with the data root. The external
 * pair prevents online replacement and alias races at the public location; the
 * internal lease prevents a renamed data root from being opened through its new
 * path while the original owner still has its database open. SQLite/OS locks are
 * released automatically if the process exits or is killed.
 */
export class RoomApplicationLease {
  readonly leasePaths: readonly string[];
  readonly #heldLeases: readonly HeldLease[];
  #closePromise: Promise<void> | undefined;

  private constructor(heldLeases: readonly HeldLease[]) {
    this.#heldLeases = heldLeases;
    this.leasePaths = Object.freeze(heldLeases.map((held) => held.leasePath));
  }

  static async acquire(roomRoot: string): Promise<RoomApplicationLease> {
    const externalLeasePaths = [...new Set(
      roomRootLeaseIdentities(roomRoot).map(leasePathForIdentity),
    )].sort((left, right) => left.localeCompare(right));
    const leasePaths = [...externalLeasePaths, internalLeasePath(roomRoot)];
    const heldLeases: HeldLease[] = [];
    try {
      for (const leasePath of leasePaths) {
        const database = new DatabaseSync(leasePath);
        try {
          chmodSync(leasePath, 0o600);
          database.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE");
        } catch (error) {
          database.close();
          throw error;
        }
        heldLeases.push({ database, leasePath });
      }
      return new RoomApplicationLease(heldLeases);
    } catch (error) {
      const cleanupErrors = heldLeases
        .reverse()
        .flatMap((held) => closeHeldLease(held));
      const acquisitionError = isSqliteBusy(error)
        ? new Error("another Room application owner is active for this durable root")
        : error;
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [acquisitionError, ...cleanupErrors],
          "Room application lease acquisition and cleanup failed",
        );
      }
      throw acquisitionError;
    }
  }

  close(): Promise<void> {
    if (!this.#closePromise) {
      this.#closePromise = Promise.resolve().then(() => {
        const errors = [...this.#heldLeases]
          .reverse()
          .flatMap((held) => closeHeldLease(held));
        if (errors.length > 0) {
          throw new AggregateError(errors, "Room application lease release failed");
        }
      });
    }
    return this.#closePromise;
  }
}
