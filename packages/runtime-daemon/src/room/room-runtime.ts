import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";

import { RoomApplicationLease } from "./room-application-lease";
import { RoomActivationLedger } from "./room-activation-ledger";
import { RoomCursorKeyStore } from "./room-cursor-key-store";
import { RoomCommandHttpAdapter } from "./room-command-http-adapter";
import { RoomCommandService } from "./room-command-service";
import { RoomLedger } from "./room-ledger";
import {
  RoomOutboxDispatcher,
  type RoomOutboxDispatchResult,
  type RoomOutboxDispatcherStatus,
} from "./room-outbox-dispatcher";
import { RoomReadHttpAdapter } from "./room-read-http-adapter";
import { RoomReadService } from "./room-read-service";
import { canonicalizeRoomRoot } from "./room-storage-path";
import { RoomWakeHub } from "./room-wake-hub";

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
  readonly commands: RoomCommandHttpAdapter;
  readonly activations: RoomActivationLedger;
  readonly wakeHub: RoomWakeHub;
  dispatchWakeHints(): Promise<RoomOutboxDispatchResult>;
  wakeStatus(): RoomOutboxDispatcherStatus;
  close(): Promise<void>;
}

class OwnedRoomApplicationRuntime implements RoomApplicationRuntime {
  readonly layout: RoomStorageLayout;
  readonly cursorGeneration: string;
  readonly http: RoomReadHttpAdapter;
  readonly commands: RoomCommandHttpAdapter;
  readonly #ledger: RoomLedger;
  readonly activations: RoomActivationLedger;
  readonly wakeHub: RoomWakeHub;
  readonly #dispatcher: RoomOutboxDispatcher;
  readonly #lease: RoomApplicationLease;
  #closePromise: Promise<void> | undefined;

  constructor(args: {
    layout: RoomStorageLayout;
    cursorGeneration: string;
    http: RoomReadHttpAdapter;
    commands: RoomCommandHttpAdapter;
    ledger: RoomLedger;
    lease: RoomApplicationLease;
    activations: RoomActivationLedger;
    wakeHub: RoomWakeHub;
    dispatcher: RoomOutboxDispatcher;
  }) {
    this.layout = args.layout;
    this.cursorGeneration = args.cursorGeneration;
    this.http = args.http;
    this.commands = args.commands;
    this.#ledger = args.ledger;
    this.#lease = args.lease;
    this.activations = args.activations;
    this.wakeHub = args.wakeHub;
    this.#dispatcher = args.dispatcher;
  }

  dispatchWakeHints(): Promise<RoomOutboxDispatchResult> {
    return this.#dispatcher.dispatchOnce();
  }

  wakeStatus(): RoomOutboxDispatcherStatus {
    return this.#dispatcher.status();
  }

  close(): Promise<void> {
    if (!this.#closePromise) {
      this.#closePromise = (async () => {
        const errors: unknown[] = [];
        try {
          await this.#dispatcher.close();
        } catch (error) {
          errors.push(error);
        }
        this.wakeHub.close();
        try {
          this.activations.close();
        } catch (error) {
          errors.push(error);
        }
        try {
          this.#ledger.close();
        } catch (error) {
          errors.push(error);
        }
        try {
          await this.#lease.close();
        } catch (error) {
          errors.push(error);
        }
        if (errors.length > 0) {
          throw new AggregateError(
            errors,
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
  dispatcherIdleDelayMs?: number;
}): Promise<RoomApplicationRuntime> {
  const layout = resolveRoomStorageLayout(args.roomRoot);
  const lease = await RoomApplicationLease.acquire(args.roomRoot);
  let ledger: RoomLedger | undefined;
  let activations: RoomActivationLedger | undefined;
  let wakeHub: RoomWakeHub | undefined;
  let dispatcher: RoomOutboxDispatcher | undefined;
  try {
    mkdirSync(layout.roomRoot, { recursive: true, mode: 0o700 });
    chmodSync(layout.roomRoot, 0o700);
    const cursorKey = new RoomCursorKeyStore(layout.cursorKeyPath).loadOrCreate();
    ledger = new RoomLedger(layout.databasePath);
    activations = new RoomActivationLedger(layout.databasePath);
    wakeHub = new RoomWakeHub();
    dispatcher = new RoomOutboxDispatcher({
      ledger,
      ...(args.dispatcherIdleDelayMs !== undefined
        ? { idleDelayMs: args.dispatcherIdleDelayMs }
        : {}),
      publishRoomEvent: (hint, { attemptId }) => {
        wakeHub!.publish(hint);
        return { status: "accepted", receiptId: `room-signal-${attemptId}` };
      },
      publishInboxWake: (hint) => {
        const receipt = hint.disposition === "activation"
          ? activations!.enqueue(hint)
          : { receiptId: `room-notification-${hint.hintId}` };
        wakeHub!.publish(hint);
        return { status: "accepted", receiptId: receipt.receiptId };
      },
    });
    dispatcher.start();
    const service = new RoomReadService(ledger, { cursorKey });
    const commands = new RoomCommandHttpAdapter(new RoomCommandService(ledger));
    return new OwnedRoomApplicationRuntime({
      layout,
      cursorGeneration: cursorKey.generation,
      http: new RoomReadHttpAdapter(service),
      commands,
      ledger,
      lease,
      activations,
      wakeHub,
      dispatcher,
    });
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    try {
      await dispatcher?.close();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    try {
      wakeHub?.close();
      activations?.close();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
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
