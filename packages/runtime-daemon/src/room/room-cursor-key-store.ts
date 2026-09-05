import { randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { RoomCursorKeyMaterial } from "./room-read-cursor";

type StoredCursorKey = {
  schemaVersion: 1;
  generation: string;
  secret: string;
  createdAt: string;
};

type StoredRotationLock = {
  schemaVersion: 1;
  expectedGeneration: string;
  targetGeneration: string;
  targetSecret: string;
  startedAt: string;
};

export interface RoomCursorKeyStoreOptions {
  /** Test/observability hook. Rotation remains offline-only. */
  onRotationPhase?: (phase: "locked" | "key_published") => void;
}

/** Persistent owner for Room cursor trust material. Not shared with device tokens. */
export class RoomCursorKeyStore {
  readonly #filePath: string;
  readonly #rotationLockPath: string;
  readonly #onRotationPhase?: RoomCursorKeyStoreOptions["onRotationPhase"];

  constructor(filePath: string, options: RoomCursorKeyStoreOptions = {}) {
    this.#filePath = filePath;
    this.#rotationLockPath = `${filePath}.rotate.lock`;
    this.#onRotationPhase = options.onRotationPhase;
  }

  loadOrCreate(): RoomCursorKeyMaterial {
    this.#assertNoInterruptedRotation();
    const material = existsSync(this.#filePath)
      ? this.#read()
      : this.#write(this.#newMaterial(), false);
    this.#assertNoInterruptedRotation();
    return material;
  }

  /** Rotate after ledger restore/rollback so pre-restore cursors cannot skip restored rows. */
  rotate(expectedGeneration: string): RoomCursorKeyMaterial {
    const directory = path.dirname(this.#filePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.#assertNoInterruptedRotation();
    const current = this.#read();
    if (current.generation !== expectedGeneration) {
      throw new Error("Room cursor key generation changed before rotation");
    }
    const target = this.#newMaterial();
    this.#publishRotationLock({
      schemaVersion: 1,
      expectedGeneration,
      targetGeneration: target.generation,
      targetSecret: Buffer.from(target.secret).toString("base64url"),
      startedAt: new Date().toISOString(),
    });
    this.#onRotationPhase?.("locked");
    const confirmed = this.#read();
    if (confirmed.generation !== expectedGeneration) {
      // This process published the lock but another completed the expected
      // rotation before this stale contender acquired it. No target key from
      // this lock was published, so removing our own evidence is safe.
      this.#completeRotation();
      throw new Error("Room cursor key generation changed during rotation");
    }
    const published = this.#write(target, true);
    this.#onRotationPhase?.("key_published");
    this.#completeRotation();
    return published;
  }

  /**
   * Complete an interrupted offline rotation. Callers must stop every Room
   * Application Port before invoking this operation.
   */
  recoverInterruptedRotation(expectedGeneration: string): RoomCursorKeyMaterial {
    const lock = this.#readRotationLock();
    if (lock.expectedGeneration !== expectedGeneration) {
      throw new Error("Room cursor rotation recovery generation does not match the operator request");
    }
    const target: RoomCursorKeyMaterial = {
      generation: lock.targetGeneration,
      secret: Buffer.from(lock.targetSecret, "base64url"),
    };
    const current = this.#read();
    let recovered: RoomCursorKeyMaterial;
    if (current.generation === lock.expectedGeneration) {
      recovered = this.#write(target, true);
    } else if (current.generation === lock.targetGeneration) {
      if (!Buffer.from(current.secret).equals(Buffer.from(target.secret))) {
        throw new Error("Room cursor rotation target key does not match recovery evidence");
      }
      recovered = current;
    } else {
      throw new Error("Room cursor key generation is outside the interrupted rotation");
    }
    this.#completeRotation();
    return recovered;
  }

  #newMaterial(): RoomCursorKeyMaterial {
    return {
      generation: randomUUID(),
      secret: randomBytes(32),
    };
  }

  #read(): RoomCursorKeyMaterial {
    try {
      const status = lstatSync(this.#filePath);
      if (
        !status.isFile() ||
        status.isSymbolicLink() ||
        status.size < 1 ||
        status.size > 4_096
      ) {
        throw new Error("Room cursor key path is not a bounded regular file");
      }
      const parsed = JSON.parse(readFileSync(this.#filePath, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Room cursor key state is invalid");
      }
      const state = parsed as Record<string, unknown>;
      if (
        Object.keys(state).length !== 4 ||
        state.schemaVersion !== 1 ||
        typeof state.generation !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(state.generation) ||
        typeof state.secret !== "string" ||
        typeof state.createdAt !== "string" ||
        Number.isNaN(Date.parse(state.createdAt))
      ) throw new Error("Room cursor key state is invalid");
      const secret = Buffer.from(state.secret, "base64url");
      if (secret.byteLength !== 32 || secret.toString("base64url") !== state.secret) {
        throw new Error("Room cursor key secret is invalid");
      }
      chmodSync(this.#filePath, 0o600);
      return { generation: state.generation, secret };
    } catch (error) {
      throw new Error(
        `Room cursor key state is invalid or corrupt: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  #assertNoInterruptedRotation(): void {
    if (existsSync(this.#rotationLockPath)) {
      throw new Error("Room cursor key rotation was interrupted; offline recovery required");
    }
  }

  #publishRotationLock(lock: StoredRotationLock): void {
    const directory = path.dirname(this.#rotationLockPath);
    const temporaryPath = `${this.#rotationLockPath}.${process.pid}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporaryPath, "wx", 0o600);
      writeFileSync(descriptor, `${JSON.stringify(lock)}\n`, "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      try {
        linkSync(temporaryPath, this.#rotationLockPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new Error("Room cursor key rotation is already in progress");
        }
        throw error;
      }
      rmSync(temporaryPath, { force: true });
      chmodSync(this.#rotationLockPath, 0o600);
      this.#syncDirectory(directory);
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

  #readRotationLock(): StoredRotationLock {
    try {
      const status = lstatSync(this.#rotationLockPath);
      if (
        !status.isFile() ||
        status.isSymbolicLink() ||
        status.size < 1 ||
        status.size > 4_096
      ) {
        throw new Error("Room cursor rotation evidence is not a bounded regular file");
      }
      const parsed = JSON.parse(readFileSync(this.#rotationLockPath, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Room cursor rotation evidence is invalid");
      }
      const state = parsed as Record<string, unknown>;
      if (
        Object.keys(state).length !== 5 ||
        state.schemaVersion !== 1 ||
        typeof state.expectedGeneration !== "string" ||
        typeof state.targetGeneration !== "string" ||
        typeof state.targetSecret !== "string" ||
        typeof state.startedAt !== "string" ||
        Number.isNaN(Date.parse(state.startedAt))
      ) throw new Error("Room cursor rotation evidence is invalid");
      const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
      if (
        !identifier.test(state.expectedGeneration) ||
        !identifier.test(state.targetGeneration) ||
        state.expectedGeneration === state.targetGeneration
      ) throw new Error("Room cursor rotation generations are invalid");
      const secret = Buffer.from(state.targetSecret, "base64url");
      if (secret.byteLength !== 32 || secret.toString("base64url") !== state.targetSecret) {
        throw new Error("Room cursor rotation target secret is invalid");
      }
      chmodSync(this.#rotationLockPath, 0o600);
      return state as unknown as StoredRotationLock;
    } catch (error) {
      throw new Error(
        `Room cursor rotation evidence is invalid or corrupt: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  #completeRotation(): void {
    const directory = path.dirname(this.#rotationLockPath);
    unlinkSync(this.#rotationLockPath);
    this.#syncDirectory(directory);
  }

  #write(material: RoomCursorKeyMaterial, replace: boolean): RoomCursorKeyMaterial {
    const directory = path.dirname(this.#filePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const state: StoredCursorKey = {
      schemaVersion: 1,
      generation: material.generation,
      secret: Buffer.from(material.secret).toString("base64url"),
      createdAt: new Date().toISOString(),
    };
    const temporaryPath = `${this.#filePath}.${process.pid}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporaryPath, "wx", 0o600);
      writeFileSync(descriptor, `${JSON.stringify(state)}\n`, "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      if (replace) {
        renameSync(temporaryPath, this.#filePath);
      } else {
        try {
          linkSync(temporaryPath, this.#filePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            rmSync(temporaryPath, { force: true });
            return this.#read();
          }
          throw error;
        }
        rmSync(temporaryPath, { force: true });
      }
      chmodSync(this.#filePath, 0o600);
      this.#syncDirectory(directory);
      return material;
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

  #syncDirectory(directory: string): void {
    const directoryDescriptor = openSync(directory, "r");
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  }
}
