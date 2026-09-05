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

/** Persistent owner for Room cursor trust material. Not shared with device tokens. */
export class RoomCursorKeyStore {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  loadOrCreate(): RoomCursorKeyMaterial {
    if (existsSync(this.#filePath)) return this.#read();
    const material = this.#newMaterial();
    return this.#write(material, false);
  }

  /** Rotate after ledger restore/rollback so pre-restore cursors cannot skip restored rows. */
  rotate(expectedGeneration: string): RoomCursorKeyMaterial {
    const directory = path.dirname(this.#filePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const lockPath = `${this.#filePath}.rotate.lock`;
    let lockDescriptor: number;
    try {
      lockDescriptor = openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("Room cursor key rotation is already in progress");
      }
      throw error;
    }
    try {
      const current = this.#read();
      if (current.generation !== expectedGeneration) {
        throw new Error("Room cursor key generation changed before rotation");
      }
      return this.#write(this.#newMaterial(), true);
    } finally {
      closeSync(lockDescriptor);
      unlinkSync(lockPath);
      this.#syncDirectory(directory);
    }
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
      if (!status.isFile() || status.isSymbolicLink()) {
        throw new Error("Room cursor key path is not a regular file");
      }
      const parsed = JSON.parse(readFileSync(this.#filePath, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Room cursor key state is invalid");
      }
      const state = parsed as Record<string, unknown>;
      if (
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
