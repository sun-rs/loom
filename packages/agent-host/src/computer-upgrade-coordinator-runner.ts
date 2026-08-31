import { lstat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { bootstrapStable, type OperationRead } from "@rah-os/k-carrier";

import type {
  KCarrierComputerUpgradeExecuteInput,
  KCarrierComputerUpgradeReadyInput,
} from "./k-carrier-computer-upgrade.ts";
import type { ManagedComputerOperationResult } from "./managed-computer-operation.ts";
import type {
  ComputerUpgradeCoordinatorRequest,
  ComputerUpgradeCoordinatorRequestStore,
} from "./computer-upgrade-coordinator-process.ts";

export type ComputerUpgradeCoordinatorPort = Readonly<{
  acknowledgeSuccessorReady(
    input: KCarrierComputerUpgradeReadyInput,
  ): Promise<ManagedComputerOperationResult>;
  execute(
    input: KCarrierComputerUpgradeExecuteInput,
  ): Promise<ManagedComputerOperationResult>;
  operation(): Promise<OperationRead>;
}>;

export type ComputerUpgradeCoordinatorRunnerOptions = Readonly<{
  createCoordinator(
    request: ComputerUpgradeCoordinatorRequest,
    context: ComputerUpgradeCoordinatorCreationContext,
  ): ComputerUpgradeCoordinatorPort | Promise<ComputerUpgradeCoordinatorPort>;
  requestStore: ComputerUpgradeCoordinatorRequestStore;
  stateDir: string;
}>;

export type ComputerUpgradeCoordinatorCreationContext =
  | Readonly<{ kind: "execute" }>
  | Readonly<{
      kind: "successor_ready";
      ready: KCarrierComputerUpgradeReadyInput;
    }>;

export type ComputerUpgradeCoordinatorRunResult =
  | ManagedComputerOperationResult
  | Readonly<{
      kind: "awaiting_successor";
      operationId: string;
    }>
  | Readonly<{ kind: "no_request" }>
  | Readonly<{
      kind: "recovery_not_needed";
      operationId: string;
    }>;

/**
 * Process-body transaction runner for the detached coordinator. The launch
 * descriptor survives the process; K survives the process; this object owns
 * neither. It clears the descriptor only after a terminal Server delivery.
 */
export class ComputerUpgradeCoordinatorRunner {
  readonly #createCoordinator: ComputerUpgradeCoordinatorRunnerOptions["createCoordinator"];
  readonly #requestStore: ComputerUpgradeCoordinatorRequestStore;
  readonly #stateDir: string;

  constructor(options: ComputerUpgradeCoordinatorRunnerOptions) {
    if (!isAbsolute(options.stateDir) || options.stateDir.includes("\0")) {
      throw new Error("Computer upgrade coordinator stateDir must be absolute");
    }
    this.#createCoordinator = options.createCoordinator;
    this.#requestStore = options.requestStore;
    this.#stateDir = resolve(options.stateDir);
  }

  async run(): Promise<ComputerUpgradeCoordinatorRunResult> {
    const loaded = await this.#load({ kind: "execute" });
    if (loaded === null) return Object.freeze({ kind: "no_request" });
    const { coordinator, request } = loaded;
    if (request.mode === "recover") {
      const operation = await coordinator.operation();
      if (!matchingObservedOperation(operation, request.operationId)) {
        return Object.freeze({
          kind: "recovery_not_needed",
          operationId: request.operationId,
        });
      }
    }
    const result = await coordinator.execute({
      assignment: {
        action: "upgrade",
        operationId: request.operationId,
        requestedAt: request.requestedAt,
        targetBuildVersion: request.targetBuildVersion,
      },
      sourceBuildVersion: request.sourceBuildVersion,
      sourceComputerInstanceId: request.sourceComputerInstanceId,
    });
    if (result.kind === "replacement_requested") {
      return Object.freeze({
        kind: "awaiting_successor",
        operationId: result.operationId,
      });
    }
    if (result.kind === "failed") {
      await this.#requestStore.clear(result.operationId);
      return result;
    }
    throw new Error(
      `Computer upgrade coordinator returned unexpected ${result.kind} result`,
    );
  }

  async acknowledgeSuccessorReady(
    input: KCarrierComputerUpgradeReadyInput,
  ): Promise<ManagedComputerOperationResult> {
    const loaded = await this.#load({ kind: "successor_ready", ready: input });
    if (loaded === null) {
      throw new Error("Computer upgrade coordinator request is unavailable");
    }
    if (input.operationId !== loaded.request.operationId) {
      throw new Error("successor ready does not match coordinator request");
    }
    const result = await loaded.coordinator.acknowledgeSuccessorReady(input);
    if (
      result.kind !== "ready_acknowledged" ||
      result.operationId !== loaded.request.operationId
    ) {
      throw new Error("successor ready was not terminally acknowledged");
    }
    await this.#requestStore.clear(result.operationId);
    return result;
  }

  async #load(
    context: ComputerUpgradeCoordinatorCreationContext,
  ): Promise<Readonly<{
    coordinator: ComputerUpgradeCoordinatorPort;
    request: ComputerUpgradeCoordinatorRequest;
  }> | null> {
    const request = await this.#requestStore.read();
    if (request === null) return null;
    await requireOwnerPrivateDirectory(this.#stateDir);
    await bootstrapStable({
      artifactPath: request.currentArtifactPath,
      stateDir: this.#stateDir,
      version: request.sourceBuildVersion,
    });
    const coordinator = await this.#createCoordinator(request, context);
    return Object.freeze({ coordinator, request });
  }
}

function matchingObservedOperation(
  operation: OperationRead,
  operationId: string,
): boolean {
  return (
    operation.kind === "observed" && operation.operation.id === operationId
  );
}

async function requireOwnerPrivateDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error(
      "Computer upgrade coordinator stateDir must be owner-private",
    );
  }
}
