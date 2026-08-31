import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createWorkerCredentialFileEnvironment } from "../src/index.ts";

test("Worker credential transport exposes only an owner-private activation file", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-worker-credential-"));
  chmodSync(directory, 0o700);
  let revoked = 0;
  try {
    const lease = await createWorkerCredentialFileEnvironment({
      credentialDirectory: directory,
      revokeCredential: () => {
        revoked += 1;
      },
      workerAccessToken: "activation-secret",
      workerApiOrigin: "http://127.0.0.1:43123",
    });

    assert.deepEqual(Object.keys(lease.env).sort(), [
      "RAH_WORKER_API_URL",
      "RAH_WORKER_SESSION_FILE",
    ]);
    assert.equal(lease.env.RAH_WORKER_API_URL, "http://127.0.0.1:43123");
    assert.equal("RAH_WORKER_TOKEN" in lease.env, false);
    const tokenPath = lease.env.RAH_WORKER_SESSION_FILE;
    assert.ok(tokenPath);
    assert.equal(readFileSync(tokenPath, "utf8"), "activation-secret");
    assert.equal(lstatSync(tokenPath).mode & 0o777, 0o600);
    const activationDirectory = join(tokenPath, "..");
    assert.equal(lstatSync(activationDirectory).mode & 0o777, 0o700);

    await lease.release?.();
    await lease.release?.();
    assert.equal(revoked, 1);
    assert.equal(existsSync(activationDirectory), false);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Worker credential transport revokes and cleans the file even when revocation fails", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-worker-revoke-fail-"));
  chmodSync(directory, 0o700);
  try {
    const lease = await createWorkerCredentialFileEnvironment({
      credentialDirectory: directory,
      revokeCredential: () => {
        throw new Error("remote revoke unavailable");
      },
      workerAccessToken: "activation-secret",
      workerApiOrigin: "https://worker.example.test",
    });
    const tokenPath = lease.env.RAH_WORKER_SESSION_FILE;
    assert.ok(tokenPath);
    const activationDirectory = join(tokenPath, "..");

    assert.ok(lease.release);
    await assert.rejects(
      async () => await lease.release!(),
      /remote revoke unavailable/u,
    );
    assert.equal(existsSync(activationDirectory), false);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Worker credential transport fails closed on an unsafe or symlinked root and revokes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-worker-unsafe-"));
  const privateDirectory = join(directory, "private");
  const link = join(directory, "credential-link");
  mkdirSync(privateDirectory, { mode: 0o700 });
  symlinkSync(privateDirectory, link);
  let revoked = 0;
  try {
    await assert.rejects(
      createWorkerCredentialFileEnvironment({
        credentialDirectory: link,
        revokeCredential: () => {
          revoked += 1;
        },
        workerAccessToken: "activation-secret",
        workerApiOrigin: "http://127.0.0.1:43123",
      }),
      /owner-private real directory/u,
    );
    assert.equal(revoked, 1);

    chmodSync(privateDirectory, 0o755);
    await assert.rejects(
      createWorkerCredentialFileEnvironment({
        credentialDirectory: privateDirectory,
        revokeCredential: () => {
          revoked += 1;
        },
        workerAccessToken: "activation-secret",
        workerApiOrigin: "http://127.0.0.1:43123",
      }),
      /owner-private real directory/u,
    );
    assert.equal(revoked, 2);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Worker credential transport rejects ambiguous credentials before launch", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-worker-invalid-"));
  chmodSync(directory, 0o700);
  let revoked = 0;
  try {
    await assert.rejects(
      createWorkerCredentialFileEnvironment({
        credentialDirectory: directory,
        revokeCredential: () => {
          revoked += 1;
        },
        workerAccessToken: "secret\nsecond-line",
        workerApiOrigin: "http://127.0.0.1:43123",
      }),
      /single-line/u,
    );
    assert.equal(revoked, 1);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
