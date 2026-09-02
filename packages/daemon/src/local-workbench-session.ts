import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SESSION_FILENAME = "loopback-session.token";
const SESSION_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

/**
 * Owner-private loopback browser capability. It survives an ordinary Core
 * restart so an already-open same-origin page can reconcile without reload.
 */
export function loadOrCreateLocalWorkbenchSessionToken(input: {
  directory: string;
}): string {
  const directory = resolve(input.directory);
  mkdirSync(directory, { mode: 0o700, recursive: true });
  requireOwnerPrivateDirectory(directory);
  const path = join(directory, SESSION_FILENAME);
  try {
    const file = lstatSync(path);
    if (!file.isFile() || file.isSymbolicLink() || (file.mode & 0o077) !== 0) {
      throw new Error("loopback session token must be an owner-private file");
    }
    const token = readFileSync(path, "utf8").trim();
    if (!SESSION_PATTERN.test(token)) {
      throw new Error("loopback session token is malformed");
    }
    return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const token = randomBytes(32).toString("base64url");
  try {
    writeFileSync(path, `${token}\n`, { flag: "wx", mode: 0o600 });
    return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return loadOrCreateLocalWorkbenchSessionToken({ directory });
  }
}

function requireOwnerPrivateDirectory(path: string): void {
  const directory = lstatSync(path);
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    (directory.mode & 0o077) !== 0
  ) {
    throw new Error("loopback session directory must be owner-private");
  }
}
