import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { isAbsolute, join, resolve } from "node:path";

const INSTANCE_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

export type ResidentRunnerArtifactCollectorOptions = {
  controlDirectory: string;
  nowMs?: () => number;
  retentionMs?: number;
  socketDirectory: string;
};

export type ResidentRunnerArtifactCollection = {
  preservedLiveInstanceIds: string[];
  removedInstanceIds: string[];
  skippedInstanceIds: string[];
};

/**
 * Removes only acknowledged-by-absence resident wrapper artifacts. Unknown
 * content and accepting control sockets are preservation evidence, not litter.
 */
export class ResidentRunnerArtifactCollector {
  readonly #controlDirectory: string;
  readonly #nowMs: () => number;
  readonly #retentionMs: number;
  readonly #socketDirectory: string;

  constructor(options: ResidentRunnerArtifactCollectorOptions) {
    this.#controlDirectory = absolutePath(
      options.controlDirectory,
      "controlDirectory",
    );
    this.#socketDirectory = absolutePath(
      options.socketDirectory,
      "socketDirectory",
    );
    this.#nowMs = options.nowMs ?? (() => Date.now());
    this.#retentionMs = positiveInteger(
      options.retentionMs ?? 7 * 24 * 60 * 60_000,
      "retentionMs",
    );
  }

  async collect(input: {
    activeInstanceIds: readonly string[];
    retiredInstanceIds: readonly string[];
  }): Promise<ResidentRunnerArtifactCollection> {
    await ensureOwnerPrivateDirectory(this.#controlDirectory);
    await ensureOwnerPrivateDirectory(this.#socketDirectory);
    const active = new Set<string>();
    for (const instanceId of input.activeInstanceIds) {
      if (!INSTANCE_ID.test(instanceId)) {
        throw new Error("active resident runner instanceId is invalid");
      }
      active.add(instanceId);
    }
    const retired = new Set<string>();
    for (const instanceId of input.retiredInstanceIds) {
      if (!INSTANCE_ID.test(instanceId)) {
        throw new Error("retired resident runner instanceId is invalid");
      }
      if (active.has(instanceId)) {
        throw new Error(
          "resident runner instance cannot be active and retired",
        );
      }
      retired.add(instanceId);
    }
    const nowMs = this.#nowMs();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      throw new Error(
        "artifact collector clock must return epoch milliseconds",
      );
    }
    const result: ResidentRunnerArtifactCollection = {
      preservedLiveInstanceIds: [],
      removedInstanceIds: [],
      skippedInstanceIds: [],
    };
    const entries = await readdir(this.#controlDirectory, {
      withFileTypes: true,
    });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const instanceId = entry.name;
      if (
        !INSTANCE_ID.test(instanceId) ||
        active.has(instanceId) ||
        !retired.has(instanceId)
      ) {
        continue;
      }
      const instanceDirectory = join(this.#controlDirectory, instanceId);
      const metadata = await lstat(instanceDirectory);
      if (
        !entry.isDirectory() ||
        metadata.isSymbolicLink() ||
        !isOwnerPrivate(metadata)
      ) {
        result.skippedInstanceIds.push(instanceId);
        continue;
      }
      if (nowMs - metadata.mtimeMs < this.#retentionMs) continue;
      const evidence = await inspectInstanceEvidence(instanceDirectory);
      const socketPath = join(this.#socketDirectory, `${instanceId}.sock`);
      const socketState = await inspectSocket(socketPath);
      if (socketState === "live") {
        result.preservedLiveInstanceIds.push(instanceId);
        continue;
      }
      if (socketState === "unsafe") {
        result.skippedInstanceIds.push(instanceId);
        continue;
      }
      if (evidence !== "terminal") {
        result.skippedInstanceIds.push(instanceId);
        continue;
      }
      await rm(instanceDirectory, { recursive: true });
      if (socketState === "stale") await rm(socketPath, { force: true });
      result.removedInstanceIds.push(instanceId);
    }
    return result;
  }
}

async function inspectInstanceEvidence(
  path: string,
): Promise<"empty" | "terminal" | "unsafe"> {
  const entries = await readdir(path, { withFileTypes: true });
  if (entries.length === 0) return "empty";
  if (entries.length !== 1 || entries[0]?.name !== "terminal.json")
    return "unsafe";
  const terminalPath = join(path, "terminal.json");
  const metadata = await lstat(terminalPath);
  return metadata.isFile() &&
    !metadata.isSymbolicLink() &&
    isOwnerPrivate(metadata)
    ? "terminal"
    : "unsafe";
}

async function inspectSocket(
  path: string,
): Promise<"absent" | "live" | "stale" | "unsafe"> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return "absent";
    throw error;
  }
  if (
    metadata.isSymbolicLink() ||
    !metadata.isSocket() ||
    !isOwnerPrivate(metadata)
  ) {
    return "unsafe";
  }
  return (await socketAcceptsConnections(path)) ? "live" : "stale";
}

async function socketAcceptsConnections(path: string): Promise<boolean> {
  return await new Promise<boolean>((resolvePromise, reject) => {
    const socket = createConnection(path);
    let settled = false;
    const finish = (error?: Error, result?: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      if (error === undefined) resolvePromise(result ?? false);
      else reject(error);
    };
    const timeout = setTimeout(() => finish(undefined, false), 250);
    socket.once("connect", () => finish(undefined, true));
    socket.once("error", (error) => {
      if (
        hasErrorCode(error, "ECONNREFUSED") ||
        hasErrorCode(error, "ENOENT") ||
        hasErrorCode(error, "ENOTSOCK")
      ) {
        finish(undefined, false);
      } else {
        finish(error);
      }
    });
  });
}

async function ensureOwnerPrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !isOwnerPrivate(metadata)
  ) {
    throw new Error(`resident artifact root must be owner-private: ${path}`);
  }
}

function isOwnerPrivate(metadata: {
  mode: number | bigint;
  uid: number;
}): boolean {
  return (
    (Number(metadata.mode) & 0o077) === 0 &&
    (typeof process.getuid !== "function" || metadata.uid === process.getuid())
  );
}

function absolutePath(value: string, name: string): string {
  if (!isAbsolute(value) || value.includes("\0")) {
    throw new Error(`${name} must be an absolute path`);
  }
  return resolve(value);
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
