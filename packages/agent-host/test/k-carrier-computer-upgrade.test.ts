import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  bootstrapStable,
  type HostAdapter,
  type Slot,
} from "@rah-os/k-carrier";
import type {
  ComputerOperationAcknowledgeRequest,
  ComputerOperationAcknowledgeResponse,
  ComputerOperationAssignment,
} from "@rah-os/computer-protocol";

import {
  ComputerOperationReceiptStore,
  createKCarrierComputerUpgradeCoordinator,
  type ComputerReleaseSourcePort,
  type ManagedComputerUpgradeControlPort,
} from "../src/index.ts";

class FakeControl implements ManagedComputerUpgradeControlPort {
  readonly acknowledgements: ComputerOperationAcknowledgeRequest[] = [];
  throwAfterAcceptingPhase: string | undefined;

  async acknowledgeOperation(
    request: ComputerOperationAcknowledgeRequest,
  ): Promise<ComputerOperationAcknowledgeResponse> {
    this.acknowledgements.push(request);
    if (
      request.kind === "operation.progress" &&
      request.phase === this.throwAfterAcceptingPhase
    ) {
      this.throwAfterAcceptingPhase = undefined;
      throw new Error("ambiguous server response after accepting progress");
    }
    return {
      accepted: true,
      terminal: request.kind !== "operation.progress",
    };
  }
}

class SlotBackedHost implements HostAdapter {
  readonly events: string[] = [];
  readonly #stateDir: string;
  #live: { pid: number; slot: Slot; startId: string; version: string };
  #nextPid = 900;

  constructor(stateDir: string, version: string) {
    this.#stateDir = stateDir;
    this.#live = { pid: 800, slot: "stable", startId: "stable-start", version };
  }

  async healthProbe() {
    this.events.push(`probe:${this.#live.slot}:${this.#live.version}`);
    return {
      pid: this.#live.pid,
      startId: this.#live.startId,
      version: this.#live.version,
    };
  }

  async quiesce(): Promise<void> {
    this.events.push("quiesce");
  }

  async resume(): Promise<void> {
    this.events.push("resume");
  }

  async start(slot: Slot): Promise<void> {
    const version = readFileSync(
      join(this.#stateDir, "slots", slot, "VERSION"),
      "utf8",
    ).trim();
    this.#nextPid += 1;
    this.#live = {
      pid: this.#nextPid,
      slot,
      startId: `${slot}-start-${String(this.#nextPid)}`,
      version,
    };
    this.events.push(`start:${slot}:${version}`);
  }

  async stop(slot: Slot): Promise<void> {
    this.events.push(`stop:${slot}`);
  }
}

function assignment(
  operationId = "server-upgrade-1",
  targetBuildVersion = "2.0.0",
): ComputerOperationAssignment {
  return {
    action: "upgrade",
    operationId,
    requestedAt: "2026-08-28T08:00:00.000Z",
    targetBuildVersion,
  };
}

test("K carrier owns the two-slot transaction while RAH only projects proven server phases", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-k-carrier-"));
  chmodSync(directory, 0o700);
  const trustedArtifact = join(directory, "computer-1.0.0");
  const stateDir = join(directory, "upgrade");
  const receiptDirectory = join(directory, "receipts");
  const artifact = Buffer.from("verified computer build 2.0.0", "utf8");
  writeFileSync(trustedArtifact, "trusted computer build 1.0.0", {
    mode: 0o700,
  });
  await mkdir(stateDir, { mode: 0o700 });
  await mkdir(receiptDirectory, { mode: 0o700 });
  await bootstrapStable({
    artifactPath: trustedArtifact,
    stateDir,
    version: "1.0.0",
  });

  const sourceCalls: string[] = [];
  const source: ComputerReleaseSourcePort = {
    checkForUpdate: async (input) => {
      sourceCalls.push(`check:${input.currentVersion}:${input.platformKey}`);
      return null;
    },
    fetchRelease: async (version, input) => {
      sourceCalls.push(`fetch:${version}:${input.platformKey}`);
      return {
        file: "computer",
        platformKey: input.platformKey,
        sha256: createHash("sha256").update(artifact).digest("hex"),
        size: artifact.byteLength,
        url: "https://releases.example/2.0.0/computer",
        version,
      };
    },
    materializeVerifiedRelease: async (input) => {
      sourceCalls.push(`materialize:${input.release.version}`);
      writeFileSync(input.destinationPath, artifact, { mode: 0o600 });
      return { ...input.release, path: input.destinationPath };
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("K must not open a second unauthenticated download path");
  };
  const control = new FakeControl();
  const host = new SlotBackedHost(stateDir, "1.0.0");
  const receipts = new ComputerOperationReceiptStore({
    statePath: join(receiptDirectory, "operation.json"),
  });
  try {
    const coordinator = createKCarrierComputerUpgradeCoordinator({
      control,
      host,
      receipts,
      releaseSource: source,
      stateDir,
    });

    assert.deepEqual(
      await coordinator.execute({
        assignment: assignment(),
        sourceBuildVersion: "1.0.0",
        sourceComputerInstanceId: "incumbent-computer-instance",
      }),
      { kind: "replacement_requested", operationId: "server-upgrade-1" },
    );
    assert.deepEqual(
      control.acknowledgements.map((entry) =>
        entry.kind === "operation.progress" ? entry.phase : entry.kind,
      ),
      [
        "draining",
        "downloading",
        "verifying",
        "staging",
        "replacing",
        "restarting",
      ],
    );
    assert.ok(
      host.events.indexOf("quiesce") < host.events.indexOf("stop:stable"),
      "the service is durably quiesced before the incumbent stops",
    );
    assert.equal((await receipts.read())?.phase, "restarting");
    assert.equal(
      readFileSync(join(stateDir, "slots", "stable", "VERSION"), "utf8"),
      "2.0.0",
    );
    await assert.rejects(
      readFile(join(stateDir, "slots", "experiment", "VERSION"), "utf8"),
      /ENOENT/u,
    );
    assert.match(sourceCalls[0] ?? "", /^fetch:2\.0\.0:/u);
    assert.ok(sourceCalls.includes("materialize:2.0.0"));

    assert.deepEqual(
      await coordinator.acknowledgeSuccessorReady({
        observedBuildVersion: "2.0.0",
        operationId: "server-upgrade-1",
        successorComputerInstanceId: "successor-computer-instance",
      }),
      { kind: "ready_acknowledged", operationId: "server-upgrade-1" },
    );
    assert.deepEqual(control.acknowledgements.at(-1), {
      kind: "operation.ready",
      observedBuildVersion: "2.0.0",
      operationId: "server-upgrade-1",
    });
    assert.equal(await receipts.read(), null);
    const operation = await coordinator.operation();
    assert.equal(operation.kind, "observed");
    if (operation.kind === "observed") {
      assert.equal(operation.operation.outcome, "promoted");
      assert.notEqual(operation.operation.acknowledgedAtMs, null);
    }

    const secondUpgrade = await coordinator.execute({
      assignment: assignment("server-upgrade-2", "3.0.0"),
      sourceBuildVersion: "2.0.0",
      sourceComputerInstanceId: "successor-computer-instance",
    });
    assert.deepEqual(
      secondUpgrade,
      { kind: "replacement_requested", operationId: "server-upgrade-2" },
      "one detached coordinator can own sequential operations without retaining a stale binding",
    );
    assert.equal(
      readFileSync(join(stateDir, "slots", "stable", "VERSION"), "utf8"),
      "3.0.0",
    );
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { force: true, recursive: true });
  }
});

test("an ambiguous pre-handoff acknowledgement rolls back and never stops from unacknowledged intent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-k-carrier-ack-"));
  chmodSync(directory, 0o700);
  const trustedArtifact = join(directory, "computer-1.0.0");
  const stateDir = join(directory, "upgrade");
  const receiptDirectory = join(directory, "receipts");
  const artifact = Buffer.from("verified computer build 2.0.0", "utf8");
  writeFileSync(trustedArtifact, "trusted computer build 1.0.0", {
    mode: 0o700,
  });
  await mkdir(stateDir, { mode: 0o700 });
  await mkdir(receiptDirectory, { mode: 0o700 });
  await bootstrapStable({
    artifactPath: trustedArtifact,
    stateDir,
    version: "1.0.0",
  });
  const control = new FakeControl();
  control.throwAfterAcceptingPhase = "restarting";
  const host = new SlotBackedHost(stateDir, "1.0.0");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("K must not open a second unauthenticated download path");
  };
  try {
    const coordinator = createKCarrierComputerUpgradeCoordinator({
      control,
      host,
      receipts: new ComputerOperationReceiptStore({
        statePath: join(receiptDirectory, "operation.json"),
      }),
      releaseSource: {
        checkForUpdate: async () => null,
        fetchRelease: async (version, input) => ({
          file: "computer",
          platformKey: input.platformKey,
          sha256: createHash("sha256").update(artifact).digest("hex"),
          size: artifact.byteLength,
          url: "https://releases.example/2.0.0/computer",
          version,
        }),
        materializeVerifiedRelease: async (input) => {
          writeFileSync(input.destinationPath, artifact, { mode: 0o600 });
          return { ...input.release, path: input.destinationPath };
        },
      },
      stateDir,
    });

    assert.deepEqual(
      await coordinator.execute({
        assignment: assignment(),
        sourceBuildVersion: "1.0.0",
        sourceComputerInstanceId: "incumbent-computer-instance",
      }),
      {
        failureCode: "replacement_failed",
        kind: "failed",
        operationId: "server-upgrade-1",
        phase: "restarting",
      },
    );
    assert.equal(
      host.events.filter((event) => event === "stop:stable").length,
      0,
      "the old service never stops when restarting progress is not confirmed",
    );
    assert.ok(host.events.includes("start:stable:1.0.0"));
    assert.equal(
      readFileSync(join(stateDir, "slots", "stable", "VERSION"), "utf8"),
      "1.0.0",
    );
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { force: true, recursive: true });
  }
});
