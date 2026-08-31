import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createComputerServiceOwnershipProofToken,
  createComputerServiceUpgradeControlHandler,
  requestComputerServiceUpgradeControl,
  UnixSocketInstanceLock,
} from "../src/index.ts";

test("upgrade control authenticates and generation-fences hold, release, and stop", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "rah-csu-control-"));
  context.after(
    async () => await rm(directory, { force: true, recursive: true }),
  );
  const token = createComputerServiceOwnershipProofToken();
  const events: unknown[] = [];
  const lock = new UnixSocketInstanceLock({
    directory,
    handleConnection: createComputerServiceUpgradeControlHandler({
      controlToken: token,
      holdManagedAttachments: async (expected) => {
        events.push({ hold: expected });
      },
      processId: process.pid,
      releaseManagedAttachmentsHold: async () => {
        events.push("release");
      },
      scheduleStop: () => {
        events.push("stop");
      },
      serviceGeneration: "service-generation-1",
    }),
    hostId: "computer-service-upgrade-control",
  });
  await lock.acquire();
  context.after(async () => await lock.release());
  const common = {
    controlToken: token,
    expectedProcessId: process.pid,
    expectedServiceGeneration: "service-generation-1",
    socketPath: lock.socketPath,
    timeoutMs: 1_000,
  };

  assert.equal(
    (
      await requestComputerServiceUpgradeControl({
        ...common,
        expectedManagedAttachmentIdentities: {
          primary: "connection-primary",
        },
        operation: "hold",
      })
    ).accepted,
    true,
  );
  await assert.rejects(
    requestComputerServiceUpgradeControl({
      ...common,
      expectedManagedAttachmentIdentities: {
        primary: "connection-primary",
      },
      expectedServiceGeneration: "stale-generation",
      operation: "hold",
    }),
    /unavailable|rejected/u,
  );
  await assert.rejects(
    requestComputerServiceUpgradeControl({
      ...common,
      controlToken: "f".repeat(64),
      operation: "release",
    }),
    /unavailable|rejected|authentication/u,
  );
  await requestComputerServiceUpgradeControl({
    ...common,
    operation: "release",
  });
  await requestComputerServiceUpgradeControl({
    ...common,
    operation: "stop",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [
    { hold: { primary: "connection-primary" } },
    "release",
    "stop",
  ]);
});
