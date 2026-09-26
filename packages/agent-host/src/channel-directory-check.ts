import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Owner 2026-09-26 channel workspace, review 2026-09-26 P1-1/P2-1: the one
 * Host check of a Channel directory. Used when the Channel is created, and
 * again before every binding refresh, launch resolution, evidence capture and
 * file browse. A directory is accepted only while its path is canonical (no
 * symlink at the leaf or any ancestor), it is a directory, it does not
 * overlap Loom data or the channel home root, and (once recorded) it is still
 * the same directory (dev/ino). A mismatch is refused, never re-resolved.
 * A single lstat+realpath pass cannot exclude a concurrent rename race; it
 * closes stable redirection and replacement.
 */
export type ChannelDirectoryIdentity = Readonly<{ dev: string; ino: string }>;
export type ReservedDirectory = Readonly<{ path: string; label: string }>;

export type ChannelDirectoryErrorCode =
  | "attached_directory_not_absolute"
  | "attached_directory_missing"
  | "attached_directory_symlink"
  | "attached_directory_not_directory"
  | "attached_directory_not_canonical"
  | "attached_directory_reserved"
  | "attached_directory_replaced"
  | "attached_directory_unrecorded"
  | "channel_home_missing"
  | "channel_home_symlink"
  | "channel_home_not_directory"
  | "channel_home_not_canonical"
  | "channel_home_replaced"
  | "channel_home_unowned"
  | "channel_home_path_mismatch";

export class ChannelDirectoryError extends Error {
  readonly code: ChannelDirectoryErrorCode;
  constructor(code: ChannelDirectoryErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "ChannelDirectoryError";
    this.code = code;
  }
}

/** Loom data and the channel home root, canonical when they exist. */
export function reservedChannelDirectories(input: {
  stateDirectory: string;
  channelWorkspaceRoot: string;
}): ReservedDirectory[] {
  return [
    { path: canonicalOrResolved(input.stateDirectory), label: "Loom data" },
    {
      path: canonicalOrResolved(input.channelWorkspaceRoot),
      label: "the channel home root",
    },
  ];
}

/** Attached directory: returns its current identity or throws. */
export function checkAttachedDirectory(
  path: string,
  reserved: readonly ReservedDirectory[],
  expected?: ChannelDirectoryIdentity,
): ChannelDirectoryIdentity {
  if (!isAbsolute(path))
    throw new ChannelDirectoryError(
      "attached_directory_not_absolute",
      `${path} is not an absolute directory path`,
    );
  const identity = checkDirectory(path, "attached_directory");
  for (const { path: root, label } of reserved)
    if (overlaps(path, root))
      throw new ChannelDirectoryError(
        "attached_directory_reserved",
        `${path} overlaps ${label} (${root})`,
      );
  if (expected !== undefined && !sameIdentity(identity, expected))
    throw new ChannelDirectoryError(
      "attached_directory_replaced",
      `${path} is no longer the directory approved for this Channel`,
    );
  return identity;
}

/** Primary directory created by Loom: same path rules plus identity. */
export function checkChannelHomeDirectory(
  path: string,
  expected?: ChannelDirectoryIdentity,
): ChannelDirectoryIdentity {
  const identity = checkDirectory(path, "channel_home");
  if (expected !== undefined && !sameIdentity(identity, expected))
    throw new ChannelDirectoryError(
      "channel_home_replaced",
      `${path} is no longer the directory Loom created for this Channel`,
    );
  return identity;
}

function checkDirectory(
  path: string,
  kind: "attached_directory" | "channel_home",
): ChannelDirectoryIdentity {
  let stat;
  try {
    stat = lstatSync(path, { bigint: true });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    )
      throw new ChannelDirectoryError(
        `${kind}_missing`,
        `${path} does not exist`,
      );
    throw error;
  }
  if (stat.isSymbolicLink())
    throw new ChannelDirectoryError(
      `${kind}_symlink`,
      `${path} is a symlink, not a canonical directory path`,
    );
  if (!stat.isDirectory())
    throw new ChannelDirectoryError(
      `${kind}_not_directory`,
      `${path} is not a directory`,
    );
  const canonical = realpathSync(path);
  if (canonical !== path)
    throw new ChannelDirectoryError(
      `${kind}_not_canonical`,
      `${path} is not canonical; use ${canonical}`,
    );
  return { dev: String(stat.dev), ino: String(stat.ino) };
}

function sameIdentity(
  a: ChannelDirectoryIdentity,
  b: ChannelDirectoryIdentity,
): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function canonicalOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function overlaps(a: string, b: string): boolean {
  return within(a, b) || within(b, a);
}

function within(child: string, parent: string): boolean {
  const path = relative(parent, child);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}
