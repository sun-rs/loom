import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  ComputerHeartbeatRequest,
  ComputerOperationAcknowledgeRequest,
  ComputerSessionOpenRequest,
} from "@rah-os/computer-protocol";

import {
  ComputerAttachmentStore,
  createAttachmentBoundComputerUpgradeControl,
  type ComputerControlClientPort,
  type ComputerUpgradeCoordinatorRequest,
} from "../src/index.ts";

function request(artifactPath: string): ComputerUpgradeCoordinatorRequest {
  return {
    carrier: "rah-k",
    controlAttachmentId: "primary",
    currentArtifactPath: artifactPath,
    managedAttachmentIdentities: {
      primary: "connection-primary",
      secondary: "connection-secondary",
    },
    mode: "upgrade",
    operationId: "attachment-bound-upgrade",
    requestedAt: "2026-08-28T14:00:00.000Z",
    sourceBuildVersion: "1.0.0",
    sourceComputerInstanceId: "computer-source-instance",
    targetBuildVersion: "2.0.0",
  };
}

test("detached K control reopens only the operation-owning attachment", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-k-control-"));
  chmodSync(directory, 0o700);
  const attachmentStatePath = join(directory, "attachments.json");
  const store = new ComputerAttachmentStore({ statePath: attachmentStatePath });
  await store.save([
    {
      attachmentId: "primary",
      connectionId: "connection-primary",
      createdAt: "2026-08-28T14:00:00.000Z",
      hostAccessToken: "rah-host-primary",
      origin: "http://127.0.0.1:4175",
    },
    {
      attachmentId: "secondary",
      connectionId: "connection-secondary",
      createdAt: "2026-08-28T14:00:00.000Z",
      hostAccessToken: "rah-host-secondary",
      origin: "http://127.0.0.1:4176",
    },
  ]);
  const calls: unknown[] = [];
  try {
    const control = await createAttachmentBoundComputerUpgradeControl({
      attachmentStore: store,
      createClient: (attachment) => {
        calls.push({
          hostAccessToken: attachment.hostAccessToken,
          origin: attachment.origin,
        });
        return fakeControlClient(calls);
      },
      processId: 4242,
      request: request(join(directory, "computer")),
      runtimeProtocolVersion: 1,
    });

    assert.deepEqual(
      await control.acknowledgeOperation({
        kind: "operation.progress",
        operationId: "attachment-bound-upgrade",
        phase: "draining",
      }),
      { accepted: true, terminal: false },
    );
    assert.deepEqual(calls[0], {
      hostAccessToken: "rah-host-primary",
      origin: "http://127.0.0.1:4175",
    });
    const opened = calls.find(
      (entry): entry is ComputerSessionOpenRequest =>
        typeof entry === "object" && entry !== null && "connectionId" in entry,
    );
    assert.equal(opened?.connectionId, "connection-primary");
    assert.equal(opened?.computerInstanceId, "computer-source-instance");
    assert.equal(opened?.computerBuildVersion, "1.0.0");
    assert.equal(opened?.processId, 4242);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("detached K control refuses attachment identity drift before networking", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-k-control-drift-"));
  chmodSync(directory, 0o700);
  const store = new ComputerAttachmentStore({
    statePath: join(directory, "attachments.json"),
  });
  await store.save([
    {
      attachmentId: "primary",
      connectionId: "changed-connection",
      createdAt: "2026-08-28T14:00:00.000Z",
      hostAccessToken: "rah-host-primary",
      origin: "http://127.0.0.1:4175",
    },
  ]);
  let clients = 0;
  try {
    await assert.rejects(
      createAttachmentBoundComputerUpgradeControl({
        attachmentStore: store,
        createClient: () => {
          clients += 1;
          return fakeControlClient([]);
        },
        request: request(join(directory, "computer")),
        runtimeProtocolVersion: 1,
      }),
      /does not match the frozen operation identity/u,
    );
    assert.equal(clients, 0);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

function fakeControlClient(calls: unknown[]): ComputerControlClientPort {
  return {
    acknowledgeOperation: async (
      _token: string,
      operation: ComputerOperationAcknowledgeRequest,
    ) => {
      calls.push(operation);
      return { accepted: true, terminal: false };
    },
    claimOperation: async () => ({ operation: null }),
    claimPlacement: async () => ({ claim: null }),
    commandExecution: async () => {
      throw new Error("execution is outside the upgrade control fixture");
    },
    heartbeat: async (_token: string, heartbeat: ComputerHeartbeatRequest) => ({
      host: {
        hostId: "host-primary",
        instanceId: "host-instance-primary",
        lastSeenAt: "2026-08-28T14:00:01.000Z",
        participantIds: ["agent-primary"],
        state: heartbeat.state,
      },
      serverTime: "2026-08-28T14:00:01.000Z",
      sessionExpiresAt: "2026-08-28T14:01:01.000Z",
    }),
    issueWorkerCredential: async () => {
      throw new Error("Worker credentials are outside the upgrade fixture");
    },
    openSession: async (opened: ComputerSessionOpenRequest) => {
      calls.push(opened);
      return {
        acceptedControlApiVersion: 1,
        hostId: "host-primary",
        hostInstanceId: "host-instance-primary",
        serverTime: "2026-08-28T14:00:00.000Z",
        sessionAccessToken: `rah_host_session_${"a".repeat(32)}`,
        sessionExpiresAt: "2026-08-28T14:01:00.000Z",
      };
    },
    publishRuntimeOffer: async () => {
      throw new Error("Runtime Offers are outside the upgrade fixture");
    },
    revokeWorkerCredential: async () => {
      throw new Error("Worker credentials are outside the upgrade fixture");
    },
  };
}
