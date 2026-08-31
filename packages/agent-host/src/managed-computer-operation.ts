import type {
  ComputerOperationAcknowledgeRequest,
  ComputerOperationAcknowledgeResponse,
  ComputerOperationAssignment,
  ComputerOperationClaimRequest,
  ComputerOperationClaimResponse,
  ComputerOperationFailureCode,
  ComputerOperationPhase,
} from "@rah-os/computer-protocol";

import type {
  ComputerOperationReceipt,
  ComputerOperationReceiptPhase,
  ComputerOperationReceiptStorePort,
} from "./computer-operation-receipt-store.ts";

export type ManagedComputerOperationControlPort = {
  acknowledgeOperation(
    request: ComputerOperationAcknowledgeRequest,
  ): Promise<ComputerOperationAcknowledgeResponse>;
  claimOperation(
    request: ComputerOperationClaimRequest,
  ): Promise<ComputerOperationClaimResponse>;
};

export type ManagedComputerOperationEffectInput = Readonly<{
  action: "restart" | "upgrade";
  operationId: string;
  sourceBuildVersion: string;
  targetBuildVersion?: string;
}>;

export type ManagedComputerUpgradeEffectInput = Readonly<{
  operationId: string;
  sourceBuildVersion: string;
  targetBuildVersion: string;
}>;

export type ManagedComputerOperationEffects = {
  activateReplacement(
    input: ManagedComputerOperationEffectInput,
  ): Promise<void>;
  downloadUpgrade(input: ManagedComputerUpgradeEffectInput): Promise<void>;
  drain(input: ManagedComputerOperationEffectInput): Promise<void>;
  prepareReplacement(input: ManagedComputerOperationEffectInput): Promise<void>;
  stageUpgrade(input: ManagedComputerUpgradeEffectInput): Promise<void>;
  verifyUpgrade(input: ManagedComputerUpgradeEffectInput): Promise<void>;
};

export type ManagedComputerOperationResult =
  | Readonly<{ kind: "idle" }>
  | Readonly<{
      kind: "replacement_requested" | "ready_acknowledged";
      operationId: string;
    }>
  | Readonly<{
      failureCode: ComputerOperationFailureCode;
      kind: "failed";
      operationId: string;
      phase: ComputerOperationPhase;
    }>;

export type ManagedComputerOperationExecutorOptions = {
  buildVersion: string;
  computerInstanceId: string;
  control: ManagedComputerOperationControlPort;
  effects: ManagedComputerOperationEffects;
  receipts: ComputerOperationReceiptStorePort;
};

const PHASES = {
  restart: ["claimed", "draining", "restarting"],
  upgrade: [
    "claimed",
    "draining",
    "downloading",
    "verifying",
    "staging",
    "replacing",
    "restarting",
  ],
} as const satisfies Record<
  "restart" | "upgrade",
  readonly ComputerOperationReceiptPhase[]
>;

/**
 * Coordinates one server-owned operation with a local durable receipt. Local
 * effects must be idempotent by operationId. This owner never accepts a shell
 * command, URL, log body, or arbitrary failure text from the server.
 */
export class ManagedComputerOperationExecutor {
  readonly #buildVersion: string;
  readonly #computerInstanceId: string;
  readonly #control: ManagedComputerOperationControlPort;
  readonly #effects: ManagedComputerOperationEffects;
  readonly #receipts: ComputerOperationReceiptStorePort;

  constructor(options: ManagedComputerOperationExecutorOptions) {
    this.#buildVersion = required(options.buildVersion, "buildVersion", 128);
    this.#computerInstanceId = required(
      options.computerInstanceId,
      "computerInstanceId",
      512,
    );
    this.#control = options.control;
    this.#effects = options.effects;
    this.#receipts = options.receipts;
  }

  async executeOnce(): Promise<ManagedComputerOperationResult> {
    const assignment = (await this.#control.claimOperation({})).operation;
    let receipt = await this.#receipts.read();
    if (assignment === null) {
      if (receipt !== null) await this.#receipts.clear(receipt.operationId);
      return { kind: "idle" };
    }
    if (receipt === null) {
      receipt = receiptFromAssignment(
        assignment,
        this.#buildVersion,
        this.#computerInstanceId,
      );
      await this.#receipts.save(receipt);
    } else {
      requireMatchingAssignment(receipt, assignment);
    }
    if (receipt === null) {
      throw new Error("Computer operation receipt was not persisted");
    }

    if (receipt.phase === "restarting") {
      if (receipt.sourceComputerInstanceId !== this.#computerInstanceId) {
        return await this.#acknowledgeReady(receipt);
      }
      return await this.#activateReplacement(receipt);
    }
    if (receipt.sourceComputerInstanceId !== this.#computerInstanceId) {
      if (receipt.sourceBuildVersion !== this.#buildVersion) {
        return await this.#fail(
          receipt,
          "version_attestation_failed",
          currentFailurePhase(receipt),
        );
      }
      receipt = Object.freeze({
        ...receipt,
        sourceComputerInstanceId: this.#computerInstanceId,
      });
      await this.#receipts.save(receipt);
    }
    receipt = await this.#flushPendingAcknowledgement(receipt);

    const drainingReceipt = receipt;
    let outcome = await this.#advance(
      drainingReceipt,
      "draining",
      () => this.#effects.drain(effectInput(drainingReceipt)),
      "control_unavailable",
    );
    if (outcome.result !== undefined) return outcome.result;
    receipt = outcome.receipt;

    if (receipt.action === "upgrade") {
      const upgrade = upgradeEffectInput(receipt);
      outcome = await this.#advance(
        receipt,
        "downloading",
        () => this.#effects.downloadUpgrade(upgrade),
        "download_failed",
      );
      if (outcome.result !== undefined) return outcome.result;
      receipt = outcome.receipt;
      outcome = await this.#advance(
        receipt,
        "verifying",
        () => this.#effects.verifyUpgrade(upgrade),
        "verification_failed",
      );
      if (outcome.result !== undefined) return outcome.result;
      receipt = outcome.receipt;
      outcome = await this.#advance(
        receipt,
        "staging",
        () => this.#effects.stageUpgrade(upgrade),
        "staging_failed",
      );
      if (outcome.result !== undefined) return outcome.result;
      receipt = outcome.receipt;
      const replacingReceipt = receipt;
      outcome = await this.#advance(
        replacingReceipt,
        "replacing",
        () => this.#effects.prepareReplacement(effectInput(replacingReceipt)),
        "replacement_failed",
      );
      if (outcome.result !== undefined) return outcome.result;
      receipt = outcome.receipt;
    } else if (receipt.phase === "draining") {
      try {
        await this.#effects.prepareReplacement(effectInput(receipt));
      } catch {
        return await this.#fail(receipt, "replacement_failed", "restarting");
      }
    }

    outcome = await this.#advance(
      receipt,
      "restarting",
      async () => undefined,
      "replacement_failed",
    );
    if (outcome.result !== undefined) return outcome.result;
    return await this.#activateReplacement(outcome.receipt);
  }

  async #advance(
    receipt: ComputerOperationReceipt,
    phase: ComputerOperationPhase,
    effect: () => Promise<void>,
    failureCode: ComputerOperationFailureCode,
  ): Promise<{
    receipt: ComputerOperationReceipt;
    result?: ManagedComputerOperationResult;
  }> {
    const phases: readonly ComputerOperationReceiptPhase[] =
      PHASES[receipt.action];
    const currentIndex = phases.indexOf(receipt.phase);
    const nextIndex = phases.indexOf(phase);
    if (nextIndex <= currentIndex) return { receipt };
    if (nextIndex !== currentIndex + 1) {
      throw new Error("Computer operation receipt has a non-contiguous phase");
    }
    try {
      await effect();
    } catch {
      return {
        receipt,
        result: await this.#fail(receipt, failureCode, phase),
      };
    }
    const pending = Object.freeze({ ...receipt, pendingPhase: phase });
    await this.#receipts.save(pending);
    await this.#control.acknowledgeOperation({
      kind: "operation.progress",
      operationId: receipt.operationId,
      phase,
    });
    const advanced = withoutPendingPhase(pending, phase);
    await this.#receipts.save(advanced);
    return { receipt: advanced };
  }

  async #flushPendingAcknowledgement(
    receipt: ComputerOperationReceipt,
  ): Promise<ComputerOperationReceipt> {
    const phase = receipt.pendingPhase;
    if (phase === undefined) return receipt;
    await this.#control.acknowledgeOperation({
      kind: "operation.progress",
      operationId: receipt.operationId,
      phase,
    });
    const advanced = withoutPendingPhase(receipt, phase);
    await this.#receipts.save(advanced);
    return advanced;
  }

  async #acknowledgeReady(
    receipt: ComputerOperationReceipt,
  ): Promise<ManagedComputerOperationResult> {
    const expectedBuildVersion =
      receipt.action === "upgrade"
        ? receipt.targetBuildVersion
        : receipt.sourceBuildVersion;
    if (this.#buildVersion !== expectedBuildVersion) {
      return await this.#fail(
        receipt,
        "version_attestation_failed",
        "restarting",
      );
    }
    const response = await this.#control.acknowledgeOperation({
      kind: "operation.ready",
      observedBuildVersion: this.#buildVersion,
      operationId: receipt.operationId,
    });
    if (!response.terminal) {
      throw new Error(
        "Computer operation ready acknowledgement was not terminal",
      );
    }
    await this.#receipts.clear(receipt.operationId);
    return { kind: "ready_acknowledged", operationId: receipt.operationId };
  }

  async #activateReplacement(
    receipt: ComputerOperationReceipt,
  ): Promise<ManagedComputerOperationResult> {
    try {
      await this.#effects.activateReplacement(effectInput(receipt));
      return {
        kind: "replacement_requested",
        operationId: receipt.operationId,
      };
    } catch {
      return await this.#fail(receipt, "replacement_failed", "restarting");
    }
  }

  async #fail(
    receipt: ComputerOperationReceipt,
    failureCode: ComputerOperationFailureCode,
    phase: ComputerOperationPhase,
  ): Promise<ManagedComputerOperationResult> {
    const response = await this.#control.acknowledgeOperation({
      failureCode,
      kind: "operation.failed",
      operationId: receipt.operationId,
      phase,
    });
    if (!response.terminal) {
      throw new Error(
        "Computer operation failure acknowledgement was not terminal",
      );
    }
    await this.#receipts.clear(receipt.operationId);
    return {
      failureCode,
      kind: "failed",
      operationId: receipt.operationId,
      phase,
    };
  }
}

function receiptFromAssignment(
  assignment: ComputerOperationAssignment,
  sourceBuildVersion: string,
  sourceComputerInstanceId: string,
): ComputerOperationReceipt {
  return Object.freeze(
    assignment.action === "restart"
      ? {
          action: assignment.action,
          operationId: assignment.operationId,
          phase: "claimed" as const,
          requestedAt: assignment.requestedAt,
          sourceBuildVersion,
          sourceComputerInstanceId,
        }
      : {
          action: assignment.action,
          operationId: assignment.operationId,
          phase: "claimed" as const,
          requestedAt: assignment.requestedAt,
          sourceBuildVersion,
          sourceComputerInstanceId,
          targetBuildVersion: assignment.targetBuildVersion,
        },
  );
}

function requireMatchingAssignment(
  receipt: ComputerOperationReceipt,
  assignment: ComputerOperationAssignment,
): void {
  if (
    receipt.operationId !== assignment.operationId ||
    receipt.action !== assignment.action ||
    receipt.requestedAt !== assignment.requestedAt ||
    (receipt.action === "upgrade" &&
      (assignment.action !== "upgrade" ||
        receipt.targetBuildVersion !== assignment.targetBuildVersion))
  ) {
    throw new Error(
      "durable Computer operation receipt does not match server assignment",
    );
  }
}

function effectInput(
  receipt: ComputerOperationReceipt,
): ManagedComputerOperationEffectInput {
  return {
    action: receipt.action,
    operationId: receipt.operationId,
    sourceBuildVersion: receipt.sourceBuildVersion,
    ...(receipt.action === "upgrade"
      ? { targetBuildVersion: receipt.targetBuildVersion }
      : {}),
  };
}

function upgradeEffectInput(
  receipt: Extract<ComputerOperationReceipt, { action: "upgrade" }>,
): ManagedComputerUpgradeEffectInput {
  return {
    operationId: receipt.operationId,
    sourceBuildVersion: receipt.sourceBuildVersion,
    targetBuildVersion: receipt.targetBuildVersion,
  };
}

function currentFailurePhase(
  receipt: ComputerOperationReceipt,
): ComputerOperationPhase {
  return receipt.phase === "claimed" ? "draining" : receipt.phase;
}

function withoutPendingPhase(
  receipt: ComputerOperationReceipt,
  phase: ComputerOperationPhase,
): ComputerOperationReceipt {
  const { pendingPhase: _pendingPhase, ...durable } = receipt;
  return Object.freeze({ ...durable, phase }) as ComputerOperationReceipt;
}

function required(value: string, name: string, maximum: number): string {
  const result = value.trim();
  if (result.length === 0 || result.length > maximum || result.includes("\0")) {
    throw new Error(`${name} is invalid`);
  }
  return result;
}
