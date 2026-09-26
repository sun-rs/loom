import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import {
  ChannelDirectoryError,
  checkChannelHomeDirectory,
  type ChannelDirectoryIdentity,
} from "./channel-directory-check.ts";

/**
 * Owner 2026-09-26 channel workspace, review P2-1 and owner P2-2 option A:
 * the one Host owner of "Loom created this Channel home". Two records under
 * `<rootDirectory>/.channel-homes/`:
 *
 * - `<sha256(roomId)>.json` intent: written before creation. It proves only
 *   the intent; an existing directory with an intent alone is never adopted.
 * - `<sha256(roomId)>.created.json` completion: written only after Loom's own
 *   exclusive mkdir succeeded, with the directory's dev/ino.
 *
 * Used synchronously at Channel creation (inside the Kernel creation
 * transaction, by the daemon's preparer) and by the execution catalog for
 * Channels whose home was not created at creation time.
 */
export type ChannelHomeCreated = Readonly<{
  schemaVersion: 1;
  roomId: string;
  cwd: string;
  identity: ChannelDirectoryIdentity;
}>;
type ChannelHomeIntent = { schemaVersion: 1; roomId: string; cwd: string };

export function channelHomeRecordsRoot(rootDirectory: string): string {
  return join(rootDirectory, ".channel-homes");
}

export function readChannelHomeCreated(
  rootDirectory: string,
  roomId: string,
): ChannelHomeCreated | undefined {
  const raw = readPrivateRecord(createdPath(rootDirectory, roomId));
  if (raw === undefined) return undefined;
  if (
    raw.schemaVersion !== 1 ||
    raw.roomId !== roomId ||
    !isHomePath(raw.cwd, roomId)
  )
    throw new Error("Invalid channel home creation record");
  return {
    schemaVersion: 1,
    roomId,
    cwd: raw.cwd as string,
    identity: parseIdentity(raw.identity),
  };
}

/**
 * Create the home exclusively and publish its completion record. The path is
 * a recorded intent's, else `primaryDirectory`, else `defaultCwd`. Refuses an
 * existing directory (`channel_home_unowned`) and a path differing from a
 * recorded intent (`channel_home_path_mismatch`). `rollback` removes the
 * directory only while it is still the same, empty directory, then the
 * records; it is meant for a Channel creation that did not commit.
 */
export function createChannelHome(input: {
  rootDirectory: string;
  roomId: string;
  primaryDirectory?: string | undefined;
  defaultCwd?: string | undefined;
}): Readonly<{
  primaryDirectory: string;
  record: ChannelHomeCreated;
  rollback(): void;
}> {
  const { rootDirectory, roomId } = input;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(roomId))
    throw new Error("Channel home room id is not a safe path segment");
  ensurePrivateDirectory(channelHomeRecordsRoot(rootDirectory));
  const intentFile = intentPath(rootDirectory, roomId);
  let intent = readIntent(intentFile, roomId);
  if (intent === undefined) {
    const cwd = input.primaryDirectory ?? input.defaultCwd;
    if (cwd === undefined)
      throw new Error("Execution catalog has no channel home root");
    if (!isHomePath(cwd, roomId))
      throw new ChannelDirectoryError(
        "channel_home_path_mismatch",
        `${cwd} is not a home path for ${roomId}`,
      );
    ensureSharedDirectory(dirname(cwd));
    if (exists(cwd))
      throw new ChannelDirectoryError(
        "channel_home_unowned",
        `Channel home ${cwd} already exists and was not created by Loom; refusing to reuse it`,
      );
    writeOnce(intentFile, JSON.stringify({ schemaVersion: 1, roomId, cwd }));
    intent = readIntent(intentFile, roomId);
    if (intent === undefined)
      throw new Error("Channel home intent record vanished");
  }
  if (
    input.primaryDirectory !== undefined &&
    input.primaryDirectory !== intent.cwd
  )
    throw new ChannelDirectoryError(
      "channel_home_path_mismatch",
      `recorded channel home ${intent.cwd} differs from ${input.primaryDirectory}`,
    );
  const cwd = intent.cwd;
  ensureSharedDirectory(dirname(cwd));
  try {
    mkdirSync(cwd, { mode: 0o700 });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      throw new ChannelDirectoryError(
        "channel_home_unowned",
        `Channel home ${cwd} exists but Loom has no record of creating it (interrupted creation or a foreign directory); it was not created by Loom as far as can be proven, refusing to adopt it`,
      );
    throw error;
  }
  const record: ChannelHomeCreated = {
    schemaVersion: 1,
    roomId,
    cwd,
    identity: checkChannelHomeDirectory(cwd),
  };
  writeOnce(createdPath(rootDirectory, roomId), JSON.stringify(record));
  return Object.freeze({
    primaryDirectory: cwd,
    record,
    rollback: () => {
      try {
        checkChannelHomeDirectory(cwd, record.identity);
        if (readdirSync(cwd).length !== 0) return;
        rmdirSync(cwd);
      } catch {
        return;
      }
      for (const file of [createdPath(rootDirectory, roomId), intentFile])
        rmSync(file, { force: true });
    },
  });
}

function intentPath(rootDirectory: string, roomId: string): string {
  return join(channelHomeRecordsRoot(rootDirectory), `${hash(roomId)}.json`);
}
function createdPath(rootDirectory: string, roomId: string): string {
  return join(
    channelHomeRecordsRoot(rootDirectory),
    `${hash(roomId)}.created.json`,
  );
}
function readIntent(
  path: string,
  roomId: string,
): ChannelHomeIntent | undefined {
  const raw = readPrivateRecord(path);
  if (raw === undefined) return undefined;
  if (
    raw.schemaVersion !== 1 ||
    raw.roomId !== roomId ||
    !isHomePath(raw.cwd, roomId)
  )
    throw new Error("Invalid channel home ownership receipt");
  return { schemaVersion: 1, roomId, cwd: raw.cwd as string };
}
function isHomePath(value: unknown, roomId: string): value is string {
  return (
    typeof value === "string" &&
    isAbsolute(value) &&
    join(dirname(value), roomId) === value
  );
}
function parseIdentity(value: unknown): ChannelDirectoryIdentity {
  const raw = value as Record<string, unknown> | null;
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof raw.dev !== "string" ||
    typeof raw.ino !== "string" ||
    !/^\d+$/u.test(raw.dev) ||
    !/^\d+$/u.test(raw.ino)
  )
    throw new Error("Invalid channel directory identity");
  return { dev: raw.dev, ino: raw.ino };
}
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}
/** Existing ancestors must never be symlinks. */
function assertNoSymlink(path: string): void {
  const parent = dirname(path);
  if (parent !== path) assertNoSymlink(parent);
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink())
      throw new Error(`Execution catalog symlink: ${path}`);
    if (!stat.isDirectory())
      throw new Error("Execution catalog path is not a directory");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return;
    throw error;
  }
}
function ensureSharedDirectory(path: string): void {
  assertNoSymlink(path);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  assertNoSymlink(path);
}
function ensurePrivateDirectory(path: string): void {
  ensureSharedDirectory(path);
  const stat = lstatSync(path);
  if (
    (process.getuid !== undefined && stat.uid !== process.getuid()) ||
    (stat.mode & 0o077) !== 0
  )
    throw new Error("Execution catalog storage is not private");
}
export function readPrivateRecord(
  path: string,
): Record<string, unknown> | undefined {
  if (!exists(path)) return undefined;
  assertNoSymlink(dirname(path));
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (process.getuid !== undefined && stat.uid !== process.getuid()) ||
    (stat.mode & 0o077) !== 0
  )
    throw new Error("Unsafe execution receipt file");
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (typeof raw !== "object" || raw === null)
    throw new Error(`Invalid channel home record: ${path}`);
  return raw as Record<string, unknown>;
}
/** Exclusive publication; a record already published by another is kept. */
export function writeOnce(path: string, text: string): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(temporary, path);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST")
        return;
      throw error;
    }
    const directory = openSync(dirname(path), "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // already gone
    }
  }
}
