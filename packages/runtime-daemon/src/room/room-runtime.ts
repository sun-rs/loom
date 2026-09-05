import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";

import { RoomApplicationLease } from "./room-application-lease";
import { RoomCursorKeyStore } from "./room-cursor-key-store";
import { RoomLedger } from "./room-ledger";
import { RoomReadHttpAdapter } from "./room-read-http-adapter";
import { RoomReadService } from "./room-read-service";
import { canonicalizeRoomRoot } from "./room-storage-path";

export interface RoomStorageLayout {
  roomRoot: string;
  databasePath: string;
  cursorKeyPath: string;
}

export function resolveRoomStorageLayout(roomRoot: string): RoomStorageLayout {
  const resolvedRoot = canonicalizeRoomRoot(roomRoot);
  return Object.freeze({
    roomRoot: resolvedRoot,
    databasePath: path.join(resolvedRoot, "room.db"),
    cursorKeyPath: path.join(resolvedRoot, "cursor-key.json"),
  });
}

export interface RoomApplicationRuntime {
  readonly layout: RoomStorageLayout;
  readonly cursorGeneration: string;
  readonly http: RoomReadHttpAdapter;
  close(): Promise<void>;
}

class OwnedRoomApplicationRuntime implements RoomApplicationRuntime {
  readonly layout: RoomStorageLayout;
  readonly cursorGeneration: string;
  readonly http: RoomReadHttpAdapter;
  readonly #ledger: RoomLedger;
  readonly #lease: RoomApplicationLease;
  #closePromise: Promise<void> | undefined;

  constructor(args: {
    layout: RoomStorageLayout;
    cursorGeneration: string;
    http: RoomReadHttpAdapter;
    ledger: RoomLedger;
    lease: RoomApplicationLease;
  }) {
    this.layout = args.layout;
    this.cursorGeneration = args.cursorGeneration;
    this.http = args.http;
    this.#ledger = args.ledger;
    this.#lease = args.lease;
  }

  close(): Promise<void> {
    if (!this.#closePromise) {
      this.#closePromise = (async () => {
        let ledgerError: unknown;
        try {
          this.#ledger.close();
        } catch (error) {
          ledgerError = error;
        }
        let leaseError: unknown;
        try {
          await this.#lease.close();
        } catch (error) {
          leaseError = error;
        }
        if (ledgerError || leaseError) {
          throw new AggregateError(
            [ledgerError, leaseError].filter((error) => error !== undefined),
            "Room application runtime shutdown failed",
          );
        }
      })();
    }
    return this.#closePromise;
  }
}

export async function createRoomApplicationRuntime(args: {
  roomRoot: string;
}): Promise<RoomApplicationRuntime> {
  const layout = resolveRoomStorageLayout(args.roomRoot);
  const lease = await RoomApplicationLease.acquire(args.roomRoot);
  let ledger: RoomLedger | undefined;
  try {
    mkdirSync(layout.roomRoot, { recursive: true, mode: 0o700 });
    chmodSync(layout.roomRoot, 0o700);
    const cursorKey = new RoomCursorKeyStore(layout.cursorKeyPath).loadOrCreate();
    ledger = new RoomLedger(layout.databasePath);
    const service = new RoomReadService(ledger, { cursorKey });
    return new OwnedRoomApplicationRuntime({
      layout,
      cursorGeneration: cursorKey.generation,
      http: new RoomReadHttpAdapter(service),
      ledger,
      lease,
    });
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    try {
      ledger?.close();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    try {
      await lease.close();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Room application runtime startup and cleanup failed",
      );
    }
    throw error;
  }
}

export interface RoomCursorMaintenanceResult {
  generation: string;
}

export async function runRoomCursorMaintenance(args: {
  roomRoot: string;
  operation: "status" | "rotate" | "recover";
  expectedGeneration?: string;
}): Promise<RoomCursorMaintenanceResult> {
  const layout = resolveRoomStorageLayout(args.roomRoot);
  const lease = await RoomApplicationLease.acquire(args.roomRoot);
  try {
    mkdirSync(layout.roomRoot, { recursive: true, mode: 0o700 });
    chmodSync(layout.roomRoot, 0o700);
    const store = new RoomCursorKeyStore(layout.cursorKeyPath);
    if (args.operation === "status") {
      return { generation: store.loadOrCreate().generation };
    }
    if (!args.expectedGeneration) {
      throw new Error("expectedGeneration is required for Room cursor maintenance");
    }
    const material = args.operation === "rotate"
      ? store.rotate(args.expectedGeneration)
      : store.recoverInterruptedRotation(args.expectedGeneration);
    return { generation: material.generation };
  } finally {
    await lease.close();
  }
}
