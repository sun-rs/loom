import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { ProviderSessionKey } from "./provider-session-store.ts";

/** AgentHost owns the native file location; the binding remains the authority. */
export function piSessionDirectory(supervisorDirectory: string): string {
  if (!isAbsolute(supervisorDirectory))
    throw new Error("Pi storage must be absolute");
  return join(supervisorDirectory, "pi-sessions");
}
async function assertDirectory(directory: string) {
  const stat = await lstat(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o077) !== 0
  )
    throw new Error("Pi native directory must be private and not a symlink");
}
async function readNative(path: string, headerOnly: boolean): Promise<string> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  ).catch(() => {
    throw new Error(
      "Pi native file must be a readable regular file, never a symlink",
    );
  });
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid?.() ||
      (!headerOnly && stat.size > 32 * 1024 * 1024)
    )
      throw new Error(
        "Pi native file must be an owned regular file within the driver limit",
      );
    if (!headerOnly) return await handle.readFile("utf8");
    const buffer = Buffer.alloc(16 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const newline = buffer.subarray(0, bytesRead).indexOf(10);
    if (newline < 0) return ""; // Another instance may still be writing a new header.
    return buffer.subarray(0, newline).toString("utf8");
  } finally {
    await handle.close();
  }
}
export const readPiNativeFile = (path: string) => readNative(path, false);
export async function findPiSessionFile(
  supervisorDirectory: string,
  sessionId: string,
): Promise<string> {
  const directory = piSessionDirectory(supervisorDirectory);
  await assertDirectory(directory);
  const matches: string[] = [];
  for (const name of await readdir(directory)) {
    if (!name.endsWith(".jsonl")) continue;
    const path = join(directory, name);
    const raw = await readNative(path, true);
    let header;
    try {
      header = JSON.parse(raw);
    } catch {
      continue;
    }
    if (header?.type === "session" && header.id === sessionId)
      matches.push(path);
  }
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? "Pi native session is ambiguous"
        : "RAH_SESSION_CONTINUITY_REQUIRED: Pi bound session file missing",
    );
  return matches[0]!;
}
export async function resolvePiSessionFile(
  supervisorDirectory: string,
  key: ProviderSessionKey,
  generation: number,
  boundSessionId?: string,
): Promise<string> {
  if (boundSessionId !== undefined)
    return findPiSessionFile(supervisorDirectory, boundSessionId);
  // Preserve the old allocation exactly. Existing files are never renamed.
  return join(
    piSessionDirectory(supervisorDirectory),
    createHash("sha256")
      .update(JSON.stringify([key, generation]))
      .digest("hex") + ".jsonl",
  );
}
