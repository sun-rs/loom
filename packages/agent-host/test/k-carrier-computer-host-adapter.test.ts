import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ComputerUpgradeParkedAttachmentStore,
  KCarrierComputerHostAdapter,
  type LiveComputerServiceAttestation,
} from "../src/index.ts";

const primarySet = Object.freeze({
  primary: "connection-primary",
  secondary: "connection-secondary",
});

function attestation(
  overrides: Partial<LiveComputerServiceAttestation> = {},
): LiveComputerServiceAttestation {
  return {
    buildVersion: "1.0.0",
    managedAttachmentIdentities: primarySet,
    processId: 101,
    serviceGeneration: "service-generation-1",
    ...overrides,
  };
}

test("K host durably parks the exact managed set and resumes only from live matching evidence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-k-host-"));
  chmodSync(directory, 0o700);
  const events: string[] = [];
  let live: LiveComputerServiceAttestation | null = attestation();
  try {
    const parkedStore = new ComputerUpgradeParkedAttachmentStore({
      stateDir: directory,
    });
    const host = new KCarrierComputerHostAdapter({
      expectedManagedAttachmentIdentities: primarySet,
      parkedStore,
      service: {
        holdManagedAttachments: async (expected) => {
          events.push(`hold:${JSON.stringify(expected)}`);
        },
        readLiveServiceAttestation: async () => {
          events.push("attest");
          return live;
        },
        releaseManagedAttachmentsHold: async () => {
          events.push("release");
        },
        startService: async (slot) => {
          events.push(`start:${slot}`);
        },
        stopService: async (slot) => {
          events.push(`stop:${slot}`);
        },
      },
    });

    await host.quiesce();
    assert.deepEqual(await parkedStore.read(), primarySet);
    await host.quiesce();
    await host.stop("stable");
    await host.start("experiment");
    live = attestation({
      buildVersion: "2.0.0",
      processId: 202,
      serviceGeneration: "service-generation-2",
    });
    assert.deepEqual(await host.healthProbe(), {
      pid: 202,
      startId: "service-generation-2",
      version: "2.0.0",
    });
    await host.resume();
    assert.equal(await parkedStore.read(), null);
    assert.deepEqual(events, [
      "attest",
      `hold:${JSON.stringify(primarySet)}`,
      `hold:${JSON.stringify(primarySet)}`,
      "stop:stable",
      "start:experiment",
      "attest",
      "attest",
      "release",
      "attest",
    ]);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("K host retains the durable parked set when a live successor diverges", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-k-host-diverged-"));
  chmodSync(directory, 0o700);
  let nowMs = 0;
  try {
    const parkedStore = new ComputerUpgradeParkedAttachmentStore({
      stateDir: directory,
    });
    await parkedStore.save(primarySet);
    const host = new KCarrierComputerHostAdapter({
      expectedManagedAttachmentIdentities: primarySet,
      nowMs: () => nowMs,
      parkedStore,
      resumePollIntervalMs: 1,
      resumeTimeoutMs: 3,
      service: {
        holdManagedAttachments: async () => undefined,
        readLiveServiceAttestation: async () =>
          attestation({
            managedAttachmentIdentities: {
              primary: "connection-forged",
              secondary: "connection-secondary",
            },
          }),
        releaseManagedAttachmentsHold: async () => undefined,
        startService: async () => undefined,
        stopService: async () => undefined,
      },
      wait: async (delayMs) => {
        nowMs += delayMs;
      },
    });

    await assert.rejects(host.resume(), /diverged/u);
    assert.deepEqual(await parkedStore.read(), primarySet);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("K host recovery reuses the durable pre-hold set instead of resampling live state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-k-host-recover-"));
  chmodSync(directory, 0o700);
  const held: Readonly<Record<string, string>>[] = [];
  let liveReads = 0;
  try {
    const parkedStore = new ComputerUpgradeParkedAttachmentStore({
      stateDir: directory,
    });
    await parkedStore.save(primarySet);
    const host = new KCarrierComputerHostAdapter({
      expectedManagedAttachmentIdentities: primarySet,
      parkedStore,
      service: {
        holdManagedAttachments: async (expected) => {
          held.push(expected);
        },
        readLiveServiceAttestation: async () => {
          liveReads += 1;
          return attestation({
            managedAttachmentIdentities: {
              primary: "later-connection",
              secondary: "connection-secondary",
            },
          });
        },
        releaseManagedAttachmentsHold: async () => undefined,
        startService: async () => undefined,
        stopService: async () => undefined,
      },
    });

    await host.quiesce();
    assert.equal(liveReads, 0);
    assert.deepEqual(held, [primarySet]);
    assert.deepEqual(await parkedStore.read(), primarySet);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("K host refuses cached or absent health evidence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-k-host-probe-"));
  chmodSync(directory, 0o700);
  try {
    const host = new KCarrierComputerHostAdapter({
      expectedManagedAttachmentIdentities: primarySet,
      parkedStore: new ComputerUpgradeParkedAttachmentStore({
        stateDir: directory,
      }),
      service: {
        holdManagedAttachments: async () => undefined,
        readLiveServiceAttestation: async () => null,
        releaseManagedAttachmentsHold: async () => undefined,
        startService: async () => undefined,
        stopService: async () => undefined,
      },
    });
    await assert.rejects(host.healthProbe(), /live service attestation/u);
    await assert.rejects(host.quiesce(), /live service attestation/u);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("K host refuses to park a live set that drifted after request creation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-k-host-request-drift-"));
  chmodSync(directory, 0o700);
  let holdCalls = 0;
  try {
    const parkedStore = new ComputerUpgradeParkedAttachmentStore({
      stateDir: directory,
    });
    const host = new KCarrierComputerHostAdapter({
      expectedManagedAttachmentIdentities: primarySet,
      parkedStore,
      service: {
        holdManagedAttachments: async () => {
          holdCalls += 1;
        },
        readLiveServiceAttestation: async () =>
          attestation({
            managedAttachmentIdentities: {
              primary: "replacement-connection",
              secondary: "connection-secondary",
            },
          }),
        releaseManagedAttachmentsHold: async () => undefined,
        startService: async () => undefined,
        stopService: async () => undefined,
      },
    });

    await assert.rejects(host.quiesce(), /does not match upgrade request/u);
    assert.equal(holdCalls, 0);
    assert.equal(await parkedStore.read(), null);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
