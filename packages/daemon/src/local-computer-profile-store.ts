import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

import {
  ClientComputerProfileUpdateRequestSchema,
  ClientComputerProfileUpdateResponseSchema,
  LocalComputerProfileSchema,
  type ClientComputerProfileUpdateRequest,
  type ClientComputerProfileUpdateResponse,
  type LocalComputerProfile,
} from "@rah-os/protocol";
import { z } from "zod";

const MAXIMUM_STATE_BYTES = 512 * 1_024;
const MAXIMUM_PROFILES = 64;
const MAXIMUM_RECEIPTS = 512;

const StoredReceiptSchema = z
  .object({
    request: ClientComputerProfileUpdateRequestSchema,
    response: ClientComputerProfileUpdateResponseSchema,
  })
  .strict();

const LocalComputerProfileStateSchema = z
  .object({
    profiles: z.array(LocalComputerProfileSchema).max(MAXIMUM_PROFILES),
    receipts: z.array(StoredReceiptSchema).max(MAXIMUM_RECEIPTS),
    schemaVersion: z.literal(1),
  })
  .strict();

type LocalComputerProfileState = z.infer<
  typeof LocalComputerProfileStateSchema
>;

export type LocalComputerProfileStoreErrorCode =
  "idempotency_conflict" | "revision_conflict";

export class LocalComputerProfileStoreError extends Error {
  readonly code: LocalComputerProfileStoreErrorCode;

  constructor(code: LocalComputerProfileStoreErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Daemon-owned durable identity metadata for locally attached Computers. */
export class LocalComputerProfileStore {
  readonly #clock: () => number;
  readonly #path: string;
  #state: LocalComputerProfileState;

  constructor(input: { clock?: () => number; path: string }) {
    if (!isAbsolute(input.path)) {
      throw new Error("Computer profile state path must be absolute");
    }
    this.#clock = input.clock ?? Date.now;
    this.#path = input.path;
    assertOwnerPrivateDirectory(dirname(this.#path));
    const exists = existsSync(this.#path);
    const state: LocalComputerProfileState = exists
      ? readState(this.#path)
      : { profiles: [], receipts: [], schemaVersion: 1 };
    if (!exists) writeState(this.#path, state);
    this.#state = state;
  }

  read(hostId: string): LocalComputerProfile | undefined {
    const profile = this.#state.profiles.find(
      (candidate) => candidate.hostId === hostId,
    );
    return profile === undefined ? undefined : { ...profile };
  }

  update(
    input: ClientComputerProfileUpdateRequest,
  ): ClientComputerProfileUpdateResponse {
    const request = normalizeRequest(input);
    const receipt = this.#state.receipts.find(
      (candidate) =>
        candidate.request.idempotencyKey === request.idempotencyKey,
    );
    if (receipt !== undefined) {
      if (!sameRequest(receipt.request, request)) {
        throw new LocalComputerProfileStoreError(
          "idempotency_conflict",
          "Computer profile idempotency key was reused with different input",
        );
      }
      return ClientComputerProfileUpdateResponseSchema.parse({
        ...receipt.response,
        computer: { ...receipt.response.computer },
        deduplicated: true,
      });
    }

    const previous = this.#state.profiles.find(
      (candidate) => candidate.hostId === request.hostId,
    );
    const currentRevision = previous?.revision ?? 0;
    if (request.expectedRevision !== currentRevision) {
      throw new LocalComputerProfileStoreError(
        "revision_conflict",
        `Computer profile revision ${String(request.expectedRevision)} is stale; current revision is ${String(currentRevision)}`,
      );
    }
    const computer = LocalComputerProfileSchema.parse({
      description: request.description,
      displayName: request.displayName,
      hostId: request.hostId,
      revision: currentRevision + 1,
      updatedAt: this.#timestamp(),
    });
    const profiles = this.#state.profiles.filter(
      (candidate) => candidate.hostId !== request.hostId,
    );
    if (profiles.length >= MAXIMUM_PROFILES) {
      throw new Error("Computer profile limit reached");
    }
    profiles.push(computer);
    const response = ClientComputerProfileUpdateResponseSchema.parse({
      computer,
      deduplicated: false,
    });
    const receipts = [...this.#state.receipts, { request, response }];
    if (receipts.length > MAXIMUM_RECEIPTS) {
      receipts.splice(0, receipts.length - MAXIMUM_RECEIPTS);
    }
    const nextState = LocalComputerProfileStateSchema.parse({
      profiles,
      receipts,
      schemaVersion: 1,
    });
    writeState(this.#path, nextState);
    this.#state = nextState;
    return response;
  }

  #timestamp(): string {
    const value = this.#clock();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Computer profile clock returned an invalid timestamp");
    }
    return new Date(value).toISOString();
  }
}

function normalizeRequest(
  input: ClientComputerProfileUpdateRequest,
): ClientComputerProfileUpdateRequest {
  const parsed = ClientComputerProfileUpdateRequestSchema.parse(input);
  return {
    ...parsed,
    description:
      parsed.description === null || parsed.description.length === 0
        ? null
        : parsed.description,
  };
}

function sameRequest(
  left: ClientComputerProfileUpdateRequest,
  right: ClientComputerProfileUpdateRequest,
): boolean {
  return (
    left.description === right.description &&
    left.displayName === right.displayName &&
    left.expectedRevision === right.expectedRevision &&
    left.hostId === right.hostId &&
    left.idempotencyKey === right.idempotencyKey
  );
}

function readState(path: string): LocalComputerProfileState {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(
      "Computer profile state must be an owner-private regular file",
    );
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error("Computer profile state must be owner-private");
  }
  if (metadata.size > MAXIMUM_STATE_BYTES) {
    throw new Error("Computer profile state exceeds its safe byte limit");
  }
  return LocalComputerProfileStateSchema.parse(
    JSON.parse(readFileSync(path, "utf8")) as unknown,
  );
}

function writeState(path: string, state: LocalComputerProfileState): void {
  const directory = dirname(path);
  const temporaryPath = join(
    directory,
    `.computer-profiles-${randomUUID()}.tmp`,
  );
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, path);
    const directoryDescriptor = openSync(directory, "r");
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
  }
}

function assertOwnerPrivateDirectory(path: string): void {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Computer profile state parent must be a real directory");
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error("Computer profile state parent must be owner-private");
  }
}
