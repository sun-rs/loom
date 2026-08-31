import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createComputerServiceOwnershipProofHandler,
  createComputerServiceOwnershipProofToken,
  createComputerServiceUpgradeControlHandler,
  NodeKCarrierComputerServiceHost,
  UnixSocketInstanceLock,
} from "../src/index.ts";

test("Node K service host uses authenticated live and mutating process boundaries", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "rah-node-k-host-"));
  context.after(
    async () => await rm(directory, { force: true, recursive: true }),
  );
  const ownershipToken = createComputerServiceOwnershipProofToken();
  const upgradeToken = createComputerServiceOwnershipProofToken();
  const events: unknown[] = [];
  const attachmentIdentities = {
    primary: "connection-primary",
    secondary: "connection-secondary",
  };
  const ownership = new UnixSocketInstanceLock({
    directory,
    handleConnection: createComputerServiceOwnershipProofHandler({
      attestation: async () => ({
        buildVersion: "2.0.0",
        candidateComputerInstanceId: "computer-instance-2",
        candidateProcessId: process.pid,
        managedAttachmentIds: ["primary", "secondary"],
        managedAttachmentIdentities: attachmentIdentities,
        serviceGeneration: "service-generation-2",
        sourceProcessId: 101,
      }),
      controlToken: ownershipToken,
    }),
    hostId: "computer-service",
  });
  const control = new UnixSocketInstanceLock({
    directory,
    handleConnection: createComputerServiceUpgradeControlHandler({
      controlToken: upgradeToken,
      holdManagedAttachments: async (expected) => {
        events.push({ hold: expected });
      },
      releaseManagedAttachmentsHold: async () => {
        events.push("release");
      },
      scheduleStop: () => {
        events.push("stop");
        setTimeout(() => {
          void control.release();
          void ownership.release();
        }, 25);
      },
      serviceGeneration: "service-generation-2",
    }),
    hostId: "computer-service-upgrade-control",
  });
  await ownership.acquire();
  await control.acquire();
  context.after(async () => {
    await control.release();
    await ownership.release();
  });

  const host = new NodeKCarrierComputerServiceHost({
    launchSlotService: async (slot) => {
      events.push(`start:${slot}`);
    },
    ownershipControlToken: ownershipToken,
    ownershipSocketPath: ownership.socketPath,
    requestTimeoutMs: 1_000,
    upgradeControlSocketPath: control.socketPath,
    upgradeControlToken: upgradeToken,
  });
  assert.deepEqual(await host.readLiveServiceAttestation(), {
    buildVersion: "2.0.0",
    managedAttachmentIdentities: attachmentIdentities,
    processId: process.pid,
    serviceGeneration: "service-generation-2",
  });
  await host.holdManagedAttachments(attachmentIdentities);
  await host.startService("experiment");
  await host.releaseManagedAttachmentsHold();
  let stopCompleted = false;
  const stopping = host.stopService("stable").then(() => {
    stopCompleted = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(stopCompleted, false);
  await stopping;
  assert.deepEqual(events, [
    { hold: attachmentIdentities },
    "start:experiment",
    "release",
    "stop",
  ]);
});

test("Node K service host delegates stop and start to the launchd-owned supervisor", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "rah-k-sup-"));
  context.after(
    async () => await rm(directory, { force: true, recursive: true }),
  );
  const ownershipToken = createComputerServiceOwnershipProofToken();
  const upgradeToken = createComputerServiceOwnershipProofToken();
  const events: unknown[] = [];
  const ownership = new UnixSocketInstanceLock({
    directory,
    handleConnection: createComputerServiceOwnershipProofHandler({
      attestation: async () => ({
        buildVersion: "1.0.0",
        candidateComputerInstanceId: "source-instance",
        candidateProcessId: process.pid,
        managedAttachmentIds: ["primary"],
        managedAttachmentIdentities: { primary: "connection-primary" },
        serviceGeneration: "source-generation",
        sourceProcessId: 1,
      }),
      controlToken: ownershipToken,
    }),
    hostId: "svc-sup",
  });
  await ownership.acquire();
  context.after(async () => await ownership.release());
  const host = new NodeKCarrierComputerServiceHost({
    ownershipControlToken: ownershipToken,
    ownershipSocketPath: ownership.socketPath,
    requestTimeoutMs: 1_000,
    supervisor: {
      startForHandoff: async (slot) => {
        events.push(`start:${slot}`);
        return { kind: "running", processId: 900, slot };
      },
      stopForHandoff: async ({ expectedProcessId }) => {
        events.push({ stop: expectedProcessId });
        await ownership.release();
        return { kind: "handoff_waiting" };
      },
    },
    upgradeControlSocketPath: join(directory, "unused-upgrade.sock"),
    upgradeControlToken: upgradeToken,
  });

  await host.stopService("stable");
  await host.startService("experiment");
  assert.deepEqual(events, [{ stop: process.pid }, "start:experiment"]);
});
