// Structural port: Raft Computer 1.0.31 packages/computer/src/logRotation.ts.
// Published binary main.js SHA256 d971d8f23b3178b008ce409964082f1dacb1d638a8965f11d19fef274331aeca.
// Upstream evidence is analysis-only. RAH adaptations: typed results, explicit errors,
// no-follow file checks, exclusive archive publication, and fresh descriptor ownership.
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

export const SERVICE_LOG_MAX_BYTES = 64 * 1024 * 1024;
export const SERVICE_LOG_MAX_DAYS = 14;
type Options = { now?: Date; maxBytes?: number; maxDays?: number };
const datePattern = /^(\d{4}-\d{2}-\d{2})(?:\.\d+)?$/;
const missing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";
const ymd = (date: Date) => date.toISOString().slice(0, 10);

/** Caller owns the stopped service: never rotate an active writer's open file. */
export async function rotateLogIfNeeded(
  logPath: string,
  options: Options = {},
): Promise<string | undefined> {
  const now = options.now ?? new Date();
  const maxDays = options.maxDays ?? SERVICE_LOG_MAX_DAYS;
  const maxBytes = options.maxBytes ?? SERVICE_LOG_MAX_BYTES;
  if (
    !Number.isSafeInteger(maxDays) ||
    maxDays < 0 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1
  )
    throw new Error("Invalid service log rotation limits");
  const today = ymd(now),
    directory = dirname(logPath),
    extension = extname(logPath),
    stem = basename(logPath, extension);
  const dir = await lstat(directory).catch((error) => {
    if (missing(error)) return undefined;
    throw error;
  });
  if (!dir) return undefined;
  if (!dir.isDirectory() || dir.isSymbolicLink())
    throw new Error("Service log directory must be a regular directory");
  const stat = await lstat(logPath).catch((error) => {
    if (missing(error)) return undefined;
    throw error;
  });
  let archive: string | undefined;
  if (stat) {
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new Error("Service log must be a regular unlinked file");
    const lastDay = ymd(stat.mtime);
    if (lastDay < today || stat.size > maxBytes) {
      for (let index = 0; index <= 10000; index++) {
        const candidate = join(
          directory,
          `${stem}.${lastDay}${index ? `.${index}` : ""}${extension}`,
        );
        try {
          // Unlike rename, link cannot replace a pre-existing archive in a race.
          await link(logPath, candidate);
          await unlink(logPath);
          archive = candidate;
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      }
      if (!archive) throw new Error("Service log archive names exhausted");
    }
  }
  const cutoff = ymd(new Date(now.getTime() - maxDays * 86400000));
  for (const name of await readdir(directory)) {
    if (!name.startsWith(`${stem}.`) || !name.endsWith(extension)) continue;
    const middle = name.slice(
      stem.length + 1,
      extension ? -extension.length : undefined,
    );
    const match = datePattern.exec(middle);
    if (!match || match[1]! >= cutoff) continue;
    const path = join(directory, name);
    const entry = await lstat(path).catch((error) => {
      if (missing(error)) return undefined;
      throw error;
    });
    if (entry?.isFile() && !entry.isSymbolicLink()) await unlink(path);
  }
  return archive;
}

/** The existing launch controller calls this after stop, before launchd opens logs. */
export async function rotateServiceLogs(
  directory: string,
  prefix: "core" | "computer",
  options: Options = {},
): Promise<void> {
  for (const stream of ["stdout", "stderr"])
    await rotateLogIfNeeded(
      join(directory, `${prefix}.${stream}.log`),
      options,
    );
}

/** Source launcher owns descriptors; child inherits them only after rotation finishes. */
export async function openServiceLogs(
  directory: string,
  prefix: "core" | "computer",
  options: Options = {},
): Promise<{
  stdout: FileHandle;
  stderr: FileHandle;
  close: () => Promise<void>;
}> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await rotateServiceLogs(directory, prefix, options);
  const handles: FileHandle[] = [];
  try {
    for (const stream of ["stdout", "stderr"]) {
      const handle = await open(
        join(directory, `${prefix}.${stream}.log`),
        constants.O_WRONLY |
          constants.O_APPEND |
          constants.O_CREAT |
          constants.O_NOFOLLOW,
        0o600,
      );
      handles.push(handle);
    }
    return {
      stdout: handles[0]!,
      stderr: handles[1]!,
      close: async () => {
        await Promise.all(handles.map((handle) => handle.close()));
      },
    };
  } catch (error) {
    await Promise.all(handles.map((handle) => handle.close()));
    throw error;
  }
}
