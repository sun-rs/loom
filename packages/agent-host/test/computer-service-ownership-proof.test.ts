import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createComputerServiceOwnershipProofHandler,
  createComputerServiceOwnershipProofToken,
  readComputerServiceLiveAttestation,
  readComputerServiceOwnershipProof,
  UnixSocketInstanceLock,
  type ComputerServiceReplacementAttestation,
} from "../src/index.ts";

function attestation(): ComputerServiceReplacementAttestation {
  return {
    buildVersion: "computer/2.0.0",
    candidateComputerInstanceId: "candidate-boot",
    candidateProcessId: process.pid,
    managedAttachmentIds: ["primary", "secondary"],
    managedAttachmentIdentities: {
      primary: "connection-primary",
      secondary: "connection-secondary",
    },
    serviceGeneration: "candidate-generation",
    sourceProcessId: 101,
  };
}

test("the exclusive service lock returns an authenticated live attestation", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "rah-csp-"));
  context.after(
    async () => await rm(directory, { force: true, recursive: true }),
  );
  const token = createComputerServiceOwnershipProofToken();
  const lock = new UnixSocketInstanceLock({
    directory,
    handleConnection: createComputerServiceOwnershipProofHandler({
      attestation: async () => attestation(),
      controlToken: token,
      processId: process.pid,
    }),
    hostId: "computer-service",
  });
  await lock.acquire();
  context.after(async () => await lock.release());

  assert.deepEqual(
    await readComputerServiceOwnershipProof({
      candidateProcessId: process.pid,
      controlToken: token,
      socketPath: lock.socketPath,
      timeoutMs: 1_000,
    }),
    attestation(),
  );
  assert.deepEqual(
    await readComputerServiceLiveAttestation({
      controlToken: token,
      socketPath: lock.socketPath,
      timeoutMs: 1_000,
    }),
    attestation(),
  );
  await assert.rejects(
    readComputerServiceOwnershipProof({
      candidateProcessId: process.pid,
      controlToken: "f".repeat(64),
      socketPath: lock.socketPath,
      timeoutMs: 1_000,
    }),
    /authentication/u,
  );
  await assert.rejects(
    readComputerServiceLiveAttestation({
      controlToken: "e".repeat(64),
      socketPath: lock.socketPath,
      timeoutMs: 1_000,
    }),
    /authentication/u,
  );
});

test("proof reader treats an absent candidate lock as not-yet-ready", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "rah-csp-a-"));
  context.after(
    async () => await rm(directory, { force: true, recursive: true }),
  );
  const lock = new UnixSocketInstanceLock({
    directory,
    hostId: "computer-service",
  });

  assert.equal(
    await readComputerServiceOwnershipProof({
      candidateProcessId: process.pid,
      controlToken: createComputerServiceOwnershipProofToken(),
      socketPath: lock.socketPath,
      timeoutMs: 100,
    }),
    null,
  );
});
