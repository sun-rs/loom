import { lstat, mkdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import {
  createUpgrader,
  type HostAdapter,
  type OperationPhase,
  type OperationRead,
  type ReleaseSource,
  type Slot,
  type Upgrader,
} from "@rah-os/k-carrier";
import type {
  ComputerOperationAcknowledgeRequest,
  ComputerOperationAcknowledgeResponse,
  ComputerOperationAssignment,
  ComputerOperationFailureCode,
  ComputerOperationPhase,
} from "@rah-os/computer-protocol";

import type {
  ComputerOperationReceipt,
  ComputerOperationReceiptPhase,
  ComputerOperationReceiptStorePort,
} from "./computer-operation-receipt-store.ts";
import type {
  ManagedComputerOperationResult,
  ManagedComputerUpgradeEffectInput,
} from "./managed-computer-operation.ts";
import type { VerifiedComputerRelease } from "./computer-release-source.ts";

const UPGRADE_PROGRESS = Object.freeze([
  "draining",
  "downloading",
  "verifying",
  "staging",
  "replacing",
  "restarting",
] as const satisfies readonly ComputerOperationPhase[]);

export type ComputerReleaseSourcePort = {
  checkForUpdate(input: {
    currentVersion: string;
    platformKey: string;
  }): Promise<VerifiedComputerRelease | null>;
  fetchRelease(
    version: string,
    input: { platformKey: string },
  ): Promise<VerifiedComputerRelease>;
  materializeVerifiedRelease(input: {
    destinationPath: string;
    onProgress?: (downloaded: number, total: number) => void;
    release: VerifiedComputerRelease;
  }): Promise<VerifiedComputerRelease & Readonly<{ path: string }>>;
};

export type ManagedComputerUpgradeControlPort = {
  acknowledgeOperation(
    request: ComputerOperationAcknowledgeRequest,
  ): Promise<ComputerOperationAcknowledgeResponse>;
};

export type KCarrierComputerUpgradeCoordinatorOptions = Readonly<{
  control: ManagedComputerUpgradeControlPort;
  host: HostAdapter;
  receipts: ComputerOperationReceiptStorePort;
  releaseSource: ComputerReleaseSourcePort;
  stateDir: string;
}>;

export type KCarrierComputerUpgradeExecuteInput = Readonly<{
  assignment: ComputerOperationAssignment;
  sourceBuildVersion: string;
  sourceComputerInstanceId: string;
}>;

export type KCarrierComputerUpgradeReadyInput = Readonly<{
  observedBuildVersion: string;
  operationId: string;
  successorComputerInstanceId: string;
}>;

/**
 * The K transaction is the sole local owner of stable/experiment slots, its
 * WAL, rollback decision, and terminal outcome. The RAH receipt below is only
 * a transport delivery checkpoint: it records which already-proven K stages
 * have reached the server and never decides what bytes or process should run.
 */
export class KCarrierComputerUpgradeCoordinator {
  readonly #barrier: ServerProgressHandoffHost;
  readonly #control: ManagedComputerUpgradeControlPort;
  readonly #receipts: ComputerOperationReceiptStorePort;
  readonly #stateDir: string;
  readonly #upgrader: Upgrader;

  constructor(options: KCarrierComputerUpgradeCoordinatorOptions) {
    if (!isAbsolute(options.stateDir)) {
      throw new Error("K carrier stateDir must be absolute");
    }
    this.#stateDir = resolve(options.stateDir);
    this.#control = options.control;
    this.#receipts = options.receipts;
    this.#barrier = new ServerProgressHandoffHost({
      control: options.control,
      host: options.host,
      receipts: options.receipts,
    });
    const releases = new AuthenticatedKReleaseSource({
      source: options.releaseSource,
      stateDir: this.#stateDir,
    });
    this.#upgrader = createUpgrader({
      host: this.#barrier,
      installOwnership: () => "self",
      notificationSink: async () => undefined,
      policy: "auto",
      provenanceIdentity: {
        carrier: "rah-computer-control-v1",
        who: "rah-os-server",
      },
      source: releases,
      stateDir: this.#stateDir,
      verifiedArtifactMaterializer: (release, onProgress) =>
        releases.materialize(release, onProgress),
    });
  }

  async execute(
    input: KCarrierComputerUpgradeExecuteInput,
  ): Promise<ManagedComputerOperationResult> {
    await requireOwnerPrivateDirectory(this.#stateDir);
    const upgrade = requireUpgradeInput(input);
    let receipt = await this.#receipts.read();
    if (receipt === null) {
      receipt = createDeliveryReceipt(upgrade, input.assignment.requestedAt);
      await this.#receipts.save(receipt);
    } else {
      requireMatchingDeliveryReceipt(receipt, upgrade);
    }
    this.#barrier.bind(receipt.operationId);

    await this.#upgrader.recover();
    const recovered = await this.#upgrader.operation();
    const recoveredResult = await this.#terminalReplay(recovered, receipt);
    if (recoveredResult !== null) return recoveredResult;

    const state = await this.#upgrader.state();
    if (state.stableVersion !== upgrade.sourceBuildVersion) {
      return await this.#fail(
        receipt,
        "version_attestation_failed",
        "downloading",
      );
    }

    try {
      const outcome = await this.#upgrader.upgradeTo(
        upgrade.targetBuildVersion,
        {
          consented: true,
          operation: {
            id: upgrade.operationId,
            metadata: {
              sourceBuildVersion: upgrade.sourceBuildVersion,
              sourceComputerInstanceId: upgrade.sourceComputerInstanceId,
            },
            provenance: {
              carrier: "rah-computer-control-v1",
              who: "rah-os-server",
            },
            startedAtMs: Date.parse(input.assignment.requestedAt),
          },
        },
      );
      if (outcome.result === "promoted") {
        const current = await this.#receipts.read();
        if (current === null) {
          throw new Error("Computer upgrade delivery receipt disappeared");
        }
        await this.#barrier.projectThroughRestarting();
        return {
          kind: "replacement_requested",
          operationId: current.operationId,
        };
      }
      if (outcome.result === "rolled-back") {
        return await this.#failCurrent("replacement_failed");
      }
      return await this.#failCurrent(
        outcome.result === "up-to-date"
          ? "version_attestation_failed"
          : "unsupported_operation",
      );
    } catch (error) {
      try {
        await this.#upgrader.recover();
      } catch {
        throw error;
      }
      const operation = await this.#upgrader.operation();
      const recoveredResult = await this.#terminalReplay(operation, receipt);
      if (recoveredResult !== null) return recoveredResult;
      throw error;
    }
  }

  async acknowledgeSuccessorReady(
    input: KCarrierComputerUpgradeReadyInput,
  ): Promise<ManagedComputerOperationResult> {
    const receipt = await this.#receipts.read();
    if (receipt === null) {
      throw new Error("Computer upgrade has no delivery receipt");
    }
    requireIdentifier(input.operationId, "operationId", 512);
    requireIdentifier(
      input.successorComputerInstanceId,
      "successorComputerInstanceId",
      512,
    );
    const observedBuildVersion = requireIdentifier(
      input.observedBuildVersion,
      "observedBuildVersion",
      128,
    );
    if (
      receipt.action !== "upgrade" ||
      receipt.operationId !== input.operationId
    ) {
      throw new Error(
        "Computer upgrade ready acknowledgement does not match receipt",
      );
    }
    if (
      input.successorComputerInstanceId === receipt.sourceComputerInstanceId
    ) {
      throw new Error("Computer upgrade ready requires a successor instance");
    }
    if (observedBuildVersion !== receipt.targetBuildVersion) {
      throw new Error("Computer upgrade successor build does not match target");
    }
    this.#barrier.bind(receipt.operationId);
    const delivered = await this.#barrier.projectThroughRestarting();
    if (delivered.phase !== "restarting") {
      throw new Error("Computer upgrade did not reach the restart barrier");
    }
    const operation = await this.#upgrader.operation();
    requirePromotedOperation(operation, receipt);
    const response = await this.#control.acknowledgeOperation({
      kind: "operation.ready",
      observedBuildVersion,
      operationId: receipt.operationId,
    });
    if (!response.terminal) {
      throw new Error(
        "Computer upgrade ready acknowledgement was not terminal",
      );
    }
    const acknowledged = await this.#upgrader.acknowledgeOperation(
      receipt.operationId,
    );
    if (acknowledged !== "acknowledged") {
      throw new Error(
        `K carrier operation receipt could not be acknowledged: ${acknowledged}`,
      );
    }
    await this.#receipts.clear(receipt.operationId);
    this.#barrier.release(receipt.operationId);
    return {
      kind: "ready_acknowledged",
      operationId: receipt.operationId,
    };
  }

  operation(): Promise<OperationRead> {
    return this.#upgrader.operation();
  }

  async #terminalReplay(
    operation: OperationRead,
    receipt: ComputerOperationReceipt,
  ): Promise<ManagedComputerOperationResult | null> {
    if (operation.kind === "unreadable") {
      throw new Error("K carrier operation receipt is unreadable");
    }
    if (operation.kind === "genesis") return null;
    if (operation.operation.id !== receipt.operationId) {
      if (
        operation.operation.outcome === null ||
        operation.operation.acknowledgedAtMs === null
      ) {
        throw new Error(
          "another K carrier operation owns the local upgrade transaction",
        );
      }
      return null;
    }
    if (operation.operation.outcome === null) return null;
    if (operation.operation.outcome === "promoted") {
      if (receipt.action !== "upgrade") {
        throw new Error("K carrier promoted proof requires an upgrade receipt");
      }
      requirePromotedOperation(operation, receipt);
      await this.#barrier.projectThroughRestarting();
      return {
        kind: "replacement_requested",
        operationId: receipt.operationId,
      };
    }
    return await this.#failCurrent(failureCodeFor(operation.operation.phase));
  }

  async #failCurrent(
    failureCode: ComputerOperationFailureCode,
  ): Promise<ManagedComputerOperationResult> {
    const receipt = await this.#receipts.read();
    if (receipt === null) {
      throw new Error("Computer upgrade delivery receipt disappeared");
    }
    const operation = await this.#upgrader.operation();
    return await this.#fail(
      receipt,
      failureCode,
      failurePhaseFor(receipt, operation),
    );
  }

  async #fail(
    receipt: ComputerOperationReceipt,
    failureCode: ComputerOperationFailureCode,
    phase: ComputerOperationPhase,
  ): Promise<ManagedComputerOperationResult> {
    this.#barrier.bind(receipt.operationId);
    const delivered = await this.#barrier.flushPending();
    const failurePhase =
      delivered.phase === "claimed" ? phase : delivered.phase;
    const response = await this.#control.acknowledgeOperation({
      failureCode,
      kind: "operation.failed",
      operationId: delivered.operationId,
      phase: failurePhase,
    });
    if (!response.terminal) {
      throw new Error(
        "Computer upgrade failure acknowledgement was not terminal",
      );
    }
    const operation = await this.#upgrader.operation();
    if (
      operation.kind === "observed" &&
      operation.operation.id === delivered.operationId &&
      operation.operation.outcome !== null
    ) {
      const acknowledged = await this.#upgrader.acknowledgeOperation(
        delivered.operationId,
      );
      if (acknowledged !== "acknowledged") {
        throw new Error(
          `K carrier terminal receipt could not be acknowledged: ${acknowledged}`,
        );
      }
    }
    await this.#receipts.clear(delivered.operationId);
    this.#barrier.release(delivered.operationId);
    return {
      failureCode,
      kind: "failed",
      operationId: delivered.operationId,
      phase: failurePhase,
    };
  }
}

export function createKCarrierComputerUpgradeCoordinator(
  options: KCarrierComputerUpgradeCoordinatorOptions,
): KCarrierComputerUpgradeCoordinator {
  return new KCarrierComputerUpgradeCoordinator(options);
}

class ServerProgressHandoffHost implements HostAdapter {
  readonly #control: ManagedComputerUpgradeControlPort;
  readonly #host: HostAdapter;
  readonly #receipts: ComputerOperationReceiptStorePort;
  #operationId: string | undefined;

  constructor(options: {
    control: ManagedComputerUpgradeControlPort;
    host: HostAdapter;
    receipts: ComputerOperationReceiptStorePort;
  }) {
    this.#control = options.control;
    this.#host = options.host;
    this.#receipts = options.receipts;
  }

  bind(operationId: string): void {
    const normalized = requireIdentifier(operationId, "operationId", 512);
    if (this.#operationId !== undefined && this.#operationId !== normalized) {
      throw new Error("K carrier host is already bound to another operation");
    }
    this.#operationId = normalized;
  }

  release(operationId: string): void {
    const normalized = requireIdentifier(operationId, "operationId", 512);
    if (this.#operationId !== normalized) {
      throw new Error("K carrier host cannot release another operation");
    }
    this.#operationId = undefined;
  }

  healthProbe() {
    return this.#host.healthProbe();
  }

  async quiesce(): Promise<void> {
    await this.#host.quiesce();
    await this.projectThroughRestarting();
  }

  resume(): Promise<void> {
    return this.#host.resume();
  }

  start(slot: Slot): Promise<void> {
    return this.#host.start(slot);
  }

  stop(slot: Slot): Promise<void> {
    return this.#host.stop(slot);
  }

  async flushPending(): Promise<ComputerOperationReceipt> {
    const receipt = await this.#requireReceipt();
    if (receipt.pendingPhase === undefined) return receipt;
    await this.#acknowledge(receipt, receipt.pendingPhase);
    const advanced = withoutPending(receipt, receipt.pendingPhase);
    await this.#receipts.save(advanced);
    return advanced;
  }

  async projectThroughRestarting(): Promise<ComputerOperationReceipt> {
    let receipt = await this.flushPending();
    for (const phase of UPGRADE_PROGRESS) {
      const currentIndex = deliveryPhaseIndex(receipt.phase);
      const nextIndex = deliveryPhaseIndex(phase);
      if (nextIndex <= currentIndex) continue;
      if (nextIndex !== currentIndex + 1) {
        throw new Error("Computer upgrade delivery phases are not contiguous");
      }
      const pending = Object.freeze({ ...receipt, pendingPhase: phase });
      await this.#receipts.save(pending);
      await this.#acknowledge(pending, phase);
      receipt = withoutPending(pending, phase);
      await this.#receipts.save(receipt);
    }
    return receipt;
  }

  async #acknowledge(
    receipt: ComputerOperationReceipt,
    phase: ComputerOperationPhase,
  ): Promise<void> {
    const response = await this.#control.acknowledgeOperation({
      kind: "operation.progress",
      operationId: receipt.operationId,
      phase,
    });
    if (response.terminal) {
      throw new Error("Computer upgrade progress acknowledgement was terminal");
    }
  }

  async #requireReceipt(): Promise<ComputerOperationReceipt> {
    if (this.#operationId === undefined) {
      throw new Error("K carrier host has no bound Computer operation");
    }
    const receipt = await this.#receipts.read();
    if (receipt === null || receipt.operationId !== this.#operationId) {
      throw new Error(
        "K carrier host delivery receipt does not match operation",
      );
    }
    if (receipt.action !== "upgrade") {
      throw new Error("K carrier host accepts upgrade receipts only");
    }
    return receipt;
  }
}

class AuthenticatedKReleaseSource implements ReleaseSource {
  readonly #source: ComputerReleaseSourcePort;
  readonly #stagingDirectory: string;
  readonly #verified = new Map<string, VerifiedComputerRelease>();

  constructor(options: {
    source: ComputerReleaseSourcePort;
    stateDir: string;
  }) {
    this.#source = options.source;
    this.#stagingDirectory = join(options.stateDir, "verified-releases");
  }

  async checkForUpdate(input: { currentVersion: string; platformKey: string }) {
    const release = await this.#source.checkForUpdate(input);
    if (release !== null) this.#remember(release);
    return release;
  }

  async fetchRelease(
    version: string,
    input: { currentVersion: string; platformKey: string },
  ) {
    const release = await this.#source.fetchRelease(version, input);
    this.#remember(release);
    return release;
  }

  async materialize(
    release: Readonly<{
      sha256: string;
      size: number;
      url: string;
      version: string;
    }>,
    onProgress: (downloaded: number, total: number) => void,
  ): Promise<string> {
    const verified = this.#verified.get(release.version);
    if (
      verified === undefined ||
      releaseKey(verified) !== releaseKey(release)
    ) {
      throw new Error(
        "K requested bytes without a matching authenticated release descriptor",
      );
    }
    await mkdir(this.#stagingDirectory, { mode: 0o700, recursive: true });
    await requireOwnerPrivateDirectory(this.#stagingDirectory);
    const artifact = await this.#source.materializeVerifiedRelease({
      destinationPath: join(this.#stagingDirectory, verified.sha256),
      onProgress,
      release: verified,
    });
    if (
      artifact.path !== join(this.#stagingDirectory, verified.sha256) ||
      releaseKey(artifact) !== releaseKey(verified)
    ) {
      throw new Error(
        "authenticated release materializer changed its descriptor",
      );
    }
    return artifact.path;
  }

  #remember(release: VerifiedComputerRelease): void {
    const existing = this.#verified.get(release.version);
    if (
      existing !== undefined &&
      releaseKey(existing) !== releaseKey(release)
    ) {
      throw new Error(
        "authenticated release source changed one version descriptor",
      );
    }
    this.#verified.set(release.version, Object.freeze({ ...release }));
  }
}

function releaseKey(release: {
  sha256: string;
  size: number;
  url: string;
  version: string;
}): string {
  return JSON.stringify([
    release.version,
    release.url,
    release.sha256,
    release.size,
  ]);
}

function requireUpgradeInput(
  input: KCarrierComputerUpgradeExecuteInput,
): ManagedComputerUpgradeEffectInput &
  Readonly<{ sourceComputerInstanceId: string }> {
  if (input.assignment.action !== "upgrade") {
    throw new Error("K carrier coordinator accepts upgrade assignments only");
  }
  const startedAtMs = Date.parse(input.assignment.requestedAt);
  if (!Number.isFinite(startedAtMs)) {
    throw new Error("Computer upgrade requestedAt must be an ISO timestamp");
  }
  return Object.freeze({
    operationId: requireIdentifier(
      input.assignment.operationId,
      "operationId",
      512,
    ),
    sourceBuildVersion: requireIdentifier(
      input.sourceBuildVersion,
      "sourceBuildVersion",
      128,
    ),
    sourceComputerInstanceId: requireIdentifier(
      input.sourceComputerInstanceId,
      "sourceComputerInstanceId",
      512,
    ),
    targetBuildVersion: requireIdentifier(
      input.assignment.targetBuildVersion,
      "targetBuildVersion",
      128,
    ),
  });
}

function createDeliveryReceipt(
  input: ManagedComputerUpgradeEffectInput &
    Readonly<{ sourceComputerInstanceId: string }>,
  requestedAt: string,
): ComputerOperationReceipt {
  return Object.freeze({
    action: "upgrade",
    operationId: input.operationId,
    phase: "claimed",
    requestedAt,
    sourceBuildVersion: input.sourceBuildVersion,
    sourceComputerInstanceId: input.sourceComputerInstanceId,
    targetBuildVersion: input.targetBuildVersion,
  });
}

function requireMatchingDeliveryReceipt(
  receipt: ComputerOperationReceipt,
  input: ManagedComputerUpgradeEffectInput &
    Readonly<{ sourceComputerInstanceId: string }>,
): void {
  if (
    receipt.action !== "upgrade" ||
    receipt.operationId !== input.operationId ||
    receipt.sourceBuildVersion !== input.sourceBuildVersion ||
    receipt.sourceComputerInstanceId !== input.sourceComputerInstanceId ||
    receipt.targetBuildVersion !== input.targetBuildVersion
  ) {
    throw new Error(
      "Computer upgrade assignment conflicts with delivery receipt",
    );
  }
}

function withoutPending(
  receipt: ComputerOperationReceipt,
  phase: ComputerOperationPhase,
): ComputerOperationReceipt {
  const { pendingPhase: _pendingPhase, ...rest } = receipt;
  return Object.freeze({ ...rest, phase } as ComputerOperationReceipt);
}

function deliveryPhaseIndex(phase: ComputerOperationReceiptPhase): number {
  if (phase === "claimed") return -1;
  return UPGRADE_PROGRESS.indexOf(phase as ComputerOperationPhase);
}

function requirePromotedOperation(
  operation: OperationRead,
  receipt: Extract<ComputerOperationReceipt, { action: "upgrade" }>,
): void {
  if (
    operation.kind !== "observed" ||
    operation.operation.id !== receipt.operationId ||
    operation.operation.outcome !== "promoted" ||
    operation.operation.targetVersion !== receipt.targetBuildVersion
  ) {
    throw new Error("K carrier has no matching promoted upgrade proof");
  }
}

function failurePhaseFor(
  receipt: ComputerOperationReceipt,
  operation: OperationRead,
): ComputerOperationPhase {
  if (receipt.phase !== "claimed") return receipt.phase;
  if (operation.kind !== "observed") return "downloading";
  return serverPhaseFor(operation.operation.phase);
}

function serverPhaseFor(phase: OperationPhase): ComputerOperationPhase {
  switch (phase) {
    case "checking":
    case "downloading":
    case "held":
    case "up-to-date":
      return "downloading";
    case "verifying":
      return "verifying";
    case "staging":
      return "staging";
    case "handing-over":
    case "probing":
    case "recovering":
    case "promoted":
    case "rolled-back":
    case "failed":
      return "replacing";
  }
}

function failureCodeFor(phase: OperationPhase): ComputerOperationFailureCode {
  switch (phase) {
    case "checking":
    case "downloading":
      return "download_failed";
    case "verifying":
      return "verification_failed";
    case "staging":
      return "staging_failed";
    case "held":
    case "up-to-date":
      return "unsupported_operation";
    case "handing-over":
    case "probing":
    case "recovering":
    case "promoted":
    case "rolled-back":
    case "failed":
      return "replacement_failed";
  }
}

async function requireOwnerPrivateDirectory(directory: string): Promise<void> {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("K carrier stateDir must be a real directory");
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error("K carrier stateDir must be owner-private");
  }
}

function requireIdentifier(
  value: string,
  name: string,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}
