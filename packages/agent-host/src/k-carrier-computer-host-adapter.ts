import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, rm, type FileHandle } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import type { HostAdapter, ProcessEvidence, Slot } from "@rah-os/k-carrier";

const PARKED_SCHEMA_VERSION = 1;
const MAX_PARKED_BYTES = 64 * 1_024;
const MAX_ATTACHMENTS = 128;

export type LiveComputerServiceAttestation = Readonly<{
  buildVersion: string;
  managedAttachmentIdentities: Readonly<Record<string, string>>;
  processId: number;
  serviceGeneration: string;
}>;

export type KCarrierComputerServiceHostPort = Readonly<{
  /**
   * Durably enables runner hold only if the service still owns this exact set.
   * This compare-and-hold closes the race between attestation and parking.
   */
  holdManagedAttachments(
    expected: Readonly<Record<string, string>>,
  ): Promise<void>;
  /** One authenticated response from the currently live singleton service. */
  readLiveServiceAttestation(): Promise<LiveComputerServiceAttestation | null>;
  releaseManagedAttachmentsHold(): Promise<void>;
  startService(slot: Slot): Promise<void>;
  stopService(slot: Slot): Promise<void>;
}>;

export type ComputerUpgradeParkedAttachmentStoreOptions = Readonly<{
  stateDir: string;
}>;

/**
 * Sole durable record of the attachment set parked around a K handoff. It is
 * not a connection catalog: the attachment store and live service remain the
 * owners of configuration and liveness respectively.
 */
export class ComputerUpgradeParkedAttachmentStore {
  readonly path: string;
  readonly #stateDir: string;

  constructor(options: ComputerUpgradeParkedAttachmentStoreOptions) {
    if (!isAbsolute(options.stateDir) || options.stateDir.includes("\0")) {
      throw new Error("parked attachment stateDir must be absolute");
    }
    this.#stateDir = resolve(options.stateDir);
    this.path = join(this.#stateDir, "parked-managed-attachments.json");
  }

  async read(): Promise<Readonly<Record<string, string>> | null> {
    await requireOwnerPrivateDirectory(this.#stateDir);
    let handle: FileHandle | undefined;
    try {
      await rejectSymbolicLink(this.path);
      handle = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      requireOwnerPrivateRegularFile(await handle.stat());
      const metadata = await handle.stat();
      if (metadata.size <= 0 || metadata.size > MAX_PARKED_BYTES) {
        throw new Error("parked attachment snapshot size is invalid");
      }
      return parseParkedEnvelope(await handle.readFile("utf8"));
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      if (hasCode(error, "ELOOP")) {
        throw new Error("parked attachment snapshot must not be a symlink");
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async save(value: Readonly<Record<string, string>>): Promise<void> {
    const identities = attachmentIdentities(value);
    const current = await this.read();
    if (current !== null) {
      if (!sameAttachmentIdentities(current, identities)) {
        throw new Error("another parked attachment snapshot is already active");
      }
      return;
    }
    const serialized = `${JSON.stringify({
      managedAttachmentIdentities: identities,
      schemaVersion: PARKED_SCHEMA_VERSION,
    })}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_PARKED_BYTES) {
      throw new Error("parked attachment snapshot exceeds 64 KiB");
    }
    const temporaryPath = `${this.path}.tmp-${String(process.pid)}-${randomUUID()}`;
    let handle: FileHandle | undefined;
    let installed = false;
    try {
      handle = await open(
        temporaryPath,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      try {
        await link(temporaryPath, this.path);
        installed = true;
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
        const raced = await this.read();
        if (raced === null || !sameAttachmentIdentities(raced, identities)) {
          throw new Error(
            "another parked attachment snapshot is already active",
          );
        }
      }
    } finally {
      await handle?.close();
      await rm(temporaryPath, { force: true });
      if (installed) await syncDirectory(this.#stateDir);
    }
  }

  async clear(expected: Readonly<Record<string, string>>): Promise<void> {
    const identities = attachmentIdentities(expected);
    const current = await this.read();
    if (current === null) return;
    if (!sameAttachmentIdentities(current, identities)) {
      throw new Error("refusing to clear another parked attachment snapshot");
    }
    await rejectSymbolicLink(this.path);
    await rm(this.path);
    await syncDirectory(this.#stateDir);
  }
}

export type KCarrierComputerHostAdapterOptions = Readonly<{
  expectedManagedAttachmentIdentities: Readonly<Record<string, string>>;
  nowMs?: () => number;
  parkedStore: ComputerUpgradeParkedAttachmentStore;
  resumePollIntervalMs?: number;
  resumeTimeoutMs?: number;
  service: KCarrierComputerServiceHostPort;
  startReadyPollIntervalMs?: number;
  startReadyTimeoutMs?: number;
  wait?: (delayMs: number) => Promise<void>;
}>;

/**
 * Production K HostAdapter boundary. Slots/WAL remain K-owned; Computer
 * connection truth remains service-owned. This adapter owns only the durable
 * park/resume inverse needed to cross a whole-service process handoff.
 */
export class KCarrierComputerHostAdapter implements HostAdapter {
  readonly #expectedManagedAttachmentIdentities: Readonly<
    Record<string, string>
  >;
  readonly #nowMs: () => number;
  readonly #parkedStore: ComputerUpgradeParkedAttachmentStore;
  readonly #resumePollIntervalMs: number;
  readonly #resumeTimeoutMs: number;
  readonly #service: KCarrierComputerServiceHostPort;
  readonly #startReadyPollIntervalMs: number;
  readonly #startReadyTimeoutMs: number;
  readonly #wait: (delayMs: number) => Promise<void>;

  constructor(options: KCarrierComputerHostAdapterOptions) {
    this.#expectedManagedAttachmentIdentities = attachmentIdentities(
      options.expectedManagedAttachmentIdentities,
    );
    this.#nowMs = options.nowMs ?? Date.now;
    this.#parkedStore = options.parkedStore;
    this.#resumePollIntervalMs = positiveInteger(
      options.resumePollIntervalMs ?? 250,
      "resumePollIntervalMs",
    );
    this.#resumeTimeoutMs = positiveInteger(
      options.resumeTimeoutMs ?? 30_000,
      "resumeTimeoutMs",
    );
    this.#service = options.service;
    this.#startReadyPollIntervalMs = positiveInteger(
      options.startReadyPollIntervalMs ?? 100,
      "startReadyPollIntervalMs",
    );
    this.#startReadyTimeoutMs = positiveInteger(
      options.startReadyTimeoutMs ?? 30_000,
      "startReadyTimeoutMs",
    );
    this.#wait = options.wait ?? wait;
  }

  async quiesce(): Promise<void> {
    let parked = await this.#parkedStore.read();
    if (parked === null) {
      const live = await this.#requireLiveAttestation();
      if (
        !sameAttachmentIdentities(
          live.managedAttachmentIdentities,
          this.#expectedManagedAttachmentIdentities,
        )
      ) {
        throw new Error(
          "live managed attachment set does not match upgrade request",
        );
      }
      parked = live.managedAttachmentIdentities;
      await this.#parkedStore.save(parked);
    }
    if (
      !sameAttachmentIdentities(
        parked,
        this.#expectedManagedAttachmentIdentities,
      )
    ) {
      throw new Error(
        "durable parked attachment set does not match upgrade request",
      );
    }
    await this.#service.holdManagedAttachments(parked);
  }

  async stop(slot: Slot): Promise<void> {
    await this.#service.stopService(slot);
  }

  async start(slot: Slot): Promise<void> {
    await this.#service.startService(slot);
    const deadline = this.#time() + this.#startReadyTimeoutMs;
    while (true) {
      try {
        if ((await this.#service.readLiveServiceAttestation()) !== null) return;
      } catch {
        // Only a later authenticated live response proves readiness.
      }
      const remaining = deadline - this.#time();
      if (remaining <= 0) {
        throw new Error("started K slot produced no live service attestation");
      }
      await this.#wait(Math.min(this.#startReadyPollIntervalMs, remaining));
    }
  }

  async healthProbe(): Promise<ProcessEvidence> {
    const live = await this.#requireLiveAttestation();
    return Object.freeze({
      pid: live.processId,
      startId: live.serviceGeneration,
      version: live.buildVersion,
    });
  }

  async resume(): Promise<void> {
    const parked = await this.#parkedStore.read();
    if (parked === null) {
      throw new Error("no durable parked attachment snapshot is available");
    }
    if (
      !sameAttachmentIdentities(
        parked,
        this.#expectedManagedAttachmentIdentities,
      )
    ) {
      throw new Error(
        "durable parked attachment set does not match upgrade request",
      );
    }
    await this.#service.releaseManagedAttachmentsHold();
    const deadline = this.#time() + this.#resumeTimeoutMs;
    let diverged = false;
    while (true) {
      try {
        const live = await this.#service.readLiveServiceAttestation();
        if (live !== null) {
          const normalized = normalizeLiveAttestation(live);
          if (
            sameAttachmentIdentities(
              parked,
              normalized.managedAttachmentIdentities,
            )
          ) {
            await this.#parkedStore.clear(parked);
            return;
          }
          diverged = true;
        }
      } catch {
        // A failed live probe is unavailable evidence, never cached health.
      }
      const remaining = deadline - this.#time();
      if (remaining <= 0) {
        throw new Error(
          diverged
            ? "live successor managed attachment set diverged"
            : "live successor attestation timed out",
        );
      }
      await this.#wait(Math.min(this.#resumePollIntervalMs, remaining));
    }
  }

  async #requireLiveAttestation(): Promise<LiveComputerServiceAttestation> {
    let live: LiveComputerServiceAttestation | null;
    try {
      live = await this.#service.readLiveServiceAttestation();
    } catch (error) {
      throw new Error("live service attestation is unavailable", {
        cause: error,
      });
    }
    if (live === null) {
      throw new Error("live service attestation is unavailable");
    }
    return normalizeLiveAttestation(live);
  }

  #time(): number {
    const value = this.#nowMs();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("K host clock must return epoch milliseconds");
    }
    return value;
  }
}

function parseParkedEnvelope(raw: string): Readonly<Record<string, string>> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("parked attachment snapshot must be valid JSON");
  }
  const envelope = record(value, "parked attachment envelope");
  exactKeys(envelope, ["managedAttachmentIdentities", "schemaVersion"]);
  if (envelope.schemaVersion !== PARKED_SCHEMA_VERSION) {
    throw new Error("unsupported parked attachment snapshot schema");
  }
  return attachmentIdentities(envelope.managedAttachmentIdentities);
}

function normalizeLiveAttestation(
  value: unknown,
): LiveComputerServiceAttestation {
  const attestation = record(value, "live service attestation");
  exactKeys(attestation, [
    "buildVersion",
    "managedAttachmentIdentities",
    "processId",
    "serviceGeneration",
  ]);
  return Object.freeze({
    buildVersion: identifier(attestation.buildVersion, "buildVersion", 128),
    managedAttachmentIdentities: attachmentIdentities(
      attestation.managedAttachmentIdentities,
    ),
    processId: positiveInteger(attestation.processId, "processId"),
    serviceGeneration: identifier(
      attestation.serviceGeneration,
      "serviceGeneration",
      512,
    ),
  });
}

function attachmentIdentities(
  value: unknown,
): Readonly<Record<string, string>> {
  const input = record(value, "managedAttachmentIdentities");
  const keys = Object.keys(input).sort();
  if (keys.length > MAX_ATTACHMENTS) {
    throw new Error("managedAttachmentIdentities exceeds 128 entries");
  }
  const output: Record<string, string> = {};
  for (const key of keys) {
    const attachmentId = identifier(key, "attachmentId", 256);
    Object.defineProperty(output, attachmentId, {
      configurable: false,
      enumerable: true,
      value: identifier(
        input[key],
        `managedAttachmentIdentities.${attachmentId}`,
        512,
      ),
      writable: false,
    });
  }
  return Object.freeze(output);
}

function sameAttachmentIdentities(
  first: Readonly<Record<string, string>>,
  second: Readonly<Record<string, string>>,
): boolean {
  const firstKeys = Object.keys(first).sort();
  const secondKeys = Object.keys(second).sort();
  return (
    firstKeys.length === secondKeys.length &&
    firstKeys.every(
      (key, index) => key === secondKeys[index] && first[key] === second[key],
    )
  );
}

async function requireOwnerPrivateDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error("parked attachment directory must be owner-private");
  }
}

function requireOwnerPrivateRegularFile(metadata: {
  isFile(): boolean;
  mode: number;
  uid: number;
}): void {
  if (
    !metadata.isFile() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error(
      "parked attachment snapshot must be owner-private and regular",
    );
  }
}

async function rejectSymbolicLink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new Error("parked attachment snapshot must not be a symlink");
    }
  } catch (error) {
    if (hasCode(error, "ENOENT")) return;
    throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (
    actual.length !== sorted.length ||
    actual.some((key, index) => key !== sorted[index])
  ) {
    throw new Error("unexpected fields in K host state");
  }
}

function identifier(value: unknown, name: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

async function wait(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
