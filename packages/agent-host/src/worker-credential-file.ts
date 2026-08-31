import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import type { ActivationEnvironmentLease } from "./generic-process-adapter.ts";

const MAX_WORKER_CREDENTIAL_BYTES = 65_536;

export const RAH_WORKER_API_URL_ENV = "RAH_WORKER_API_URL";
export const RAH_WORKER_SESSION_FILE_ENV = "RAH_WORKER_SESSION_FILE";
export const RAH_WORKER_CLI_ENV = "RAH_WORKER_CLI";
export const LEGACY_RAH_WORKER_TOKEN_ENV = "RAH_WORKER_TOKEN";
export const LEGACY_RAH_WORKER_TOKEN_FILE_ENV = "RAH_WORKER_TOKEN_FILE";
export const RAH_AGENT_TOOL_BIN_ENV = "RAH_AGENT_TOOL_BIN";

/**
 * Materializes one Activation-scoped Worker credential outside argv and the
 * process environment. Revocation always precedes removal of the exact unique
 * directory; both operations are attempted when either one fails.
 */
export async function createWorkerCredentialFileEnvironment(input: {
  credentialDirectory: string;
  revokeCredential: () => Promise<void> | void;
  workerAccessToken: string;
  workerApiOrigin: string;
}): Promise<ActivationEnvironmentLease> {
  let activationDirectory: string | undefined;
  try {
    assertWorkerApiOrigin(input.workerApiOrigin);
    assertWorkerAccessToken(input.workerAccessToken);
    await ensureOwnerPrivateDirectory(input.credentialDirectory);
    activationDirectory = join(
      input.credentialDirectory,
      `activation-${randomUUID()}`,
    );
    await mkdir(activationDirectory, { mode: 0o700 });
    await assertOwnerPrivateDirectory(activationDirectory);
    const tokenPath = join(activationDirectory, "token");
    const tokenFile = await open(
      tokenPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await tokenFile.writeFile(input.workerAccessToken, "utf8");
      await tokenFile.sync();
      const metadata = await tokenFile.stat();
      if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
        throw new Error("Worker credential file is not owner-private");
      }
    } finally {
      await tokenFile.close();
    }

    let releasePromise: Promise<void> | undefined;
    return Object.freeze({
      env: Object.freeze({
        [RAH_WORKER_API_URL_ENV]: input.workerApiOrigin,
        [RAH_WORKER_SESSION_FILE_ENV]: tokenPath,
      }),
      redactions: Object.freeze([input.workerAccessToken]),
      release: () => {
        releasePromise ??= revokeAndRemove(
          input.revokeCredential,
          activationDirectory!,
        );
        return releasePromise;
      },
    });
  } catch (error) {
    const failures = [error];
    const cleanup = await Promise.allSettled([
      Promise.resolve().then(input.revokeCredential),
      activationDirectory === undefined
        ? Promise.resolve()
        : rm(activationDirectory, { force: true, recursive: true }),
    ]);
    for (const outcome of cleanup) {
      if (outcome.status === "rejected") failures.push(outcome.reason);
    }
    if (failures.length === 1) throw error;
    throw new AggregateError(
      failures,
      "Worker credential materialization and cleanup failed",
    );
  }
}

async function revokeAndRemove(
  revokeCredential: () => Promise<void> | void,
  activationDirectory: string,
): Promise<void> {
  const outcomes = await Promise.allSettled([
    Promise.resolve().then(revokeCredential),
    rm(activationDirectory, { force: true, recursive: true }),
  ]);
  const failures = outcomes.flatMap((outcome) =>
    outcome.status === "rejected" ? [outcome.reason] : [],
  );
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      "Worker credential revocation and cleanup failed",
    );
  }
}

async function ensureOwnerPrivateDirectory(path: string): Promise<void> {
  if (!isAbsolute(path)) {
    throw new Error("Worker credential directory must be absolute");
  }
  await mkdir(path, { mode: 0o700, recursive: true });
  await assertOwnerPrivateDirectory(path);
}

async function assertOwnerPrivateDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error(
      `Worker credential directory must be an owner-private real directory: ${path}`,
    );
  }
}

function assertWorkerAccessToken(token: string): void {
  const byteLength = Buffer.byteLength(token);
  if (byteLength === 0 || byteLength > MAX_WORKER_CREDENTIAL_BYTES) {
    throw new Error("Worker access token must be non-empty and bounded");
  }
  if (/[\0\r\n]/u.test(token)) {
    throw new Error("Worker access token must be a single-line value");
  }
}

function assertWorkerApiOrigin(origin: string): void {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error("Worker API origin must be an absolute HTTP(S) origin");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.origin !== origin ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error("Worker API origin must be an absolute HTTP(S) origin");
  }
}
