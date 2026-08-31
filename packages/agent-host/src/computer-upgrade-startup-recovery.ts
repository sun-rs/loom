import type { ComputerServiceReplacementAttestation } from "./computer-service-replacement.ts";
import { readComputerServiceLiveAttestation } from "./computer-service-ownership-proof.ts";
import {
  ComputerUpgradeCoordinatorRequestStore,
  NodeComputerUpgradeCoordinatorLauncher,
  type ComputerUpgradeCoordinatorLaunch,
  type ComputerUpgradeCoordinatorRequest,
} from "./computer-upgrade-coordinator-process.ts";
import type { KCarrierComputerUpgradeReadyInput } from "./k-carrier-computer-upgrade.ts";
import {
  acknowledgeNodeKCarrierComputerUpgradeSuccessor,
  type NodeKCarrierComputerUpgradeProcessConfiguration,
} from "./node-k-carrier-computer-upgrade-process.ts";

export type ComputerUpgradeStartupRecoveryFailureCode =
  | "managed_attachment_mismatch"
  | "singleton_unavailable"
  | "singleton_process_mismatch"
  | "unexpected_service_identity";

export type ComputerUpgradeStartupRecoveryDecision =
  | Readonly<{ kind: "idle" }>
  | Readonly<{
      kind: "launch_coordinator";
      operationId: string;
    }>
  | Readonly<{
      kind: "acknowledge_successor";
      ready: KCarrierComputerUpgradeReadyInput;
    }>
  | Readonly<{
      failureCode: ComputerUpgradeStartupRecoveryFailureCode;
      kind: "recovery_required";
    }>;

export type ComputerUpgradeStartupRecoveryExecutionResult =
  | ComputerUpgradeStartupRecoveryDecision
  | Readonly<{
      kind: "coordinator_launched";
      operationId: string;
      processId: number;
    }>
  | Readonly<{
      kind: "successor_acknowledged";
      operationId: string;
    }>;

export type ComputerUpgradeStartupRecoveryRuntime = Readonly<{
  acknowledgeSuccessor?: typeof acknowledgeNodeKCarrierComputerUpgradeSuccessor;
  launchCoordinator?: (input: {
    configurationPath: string;
    requestPath: string;
  }) => Promise<ComputerUpgradeCoordinatorLaunch>;
  readLiveAttestation?: typeof readComputerServiceLiveAttestation;
}>;

/**
 * Service-start composition seam used after the service has acquired its
 * singleton socket. It performs exactly one recovery action for this service
 * generation; launchd restarts provide the retry backstop.
 */
export async function recoverNodeKCarrierComputerUpgradeOnServiceStartup(
  input: Readonly<{
    argumentPrefix?: readonly string[];
    configuration: NodeKCarrierComputerUpgradeProcessConfiguration;
    configurationPath: string;
    currentProcessId?: number;
    executablePath: string;
    runtime?: ComputerUpgradeStartupRecoveryRuntime;
  }>,
): Promise<ComputerUpgradeStartupRecoveryExecutionResult> {
  const request = await new ComputerUpgradeCoordinatorRequestStore({
    requestPath: input.configuration.requestPath,
  }).read();
  const readLive =
    input.runtime?.readLiveAttestation ?? readComputerServiceLiveAttestation;
  const liveAttestation = await readLive({
    controlToken: input.configuration.ownershipControlToken,
    socketPath: input.configuration.ownershipSocketPath,
    timeoutMs: 2_000,
  });
  if (liveAttestation === null) {
    return recoveryRequired("singleton_unavailable");
  }
  const decision = planComputerUpgradeStartupRecovery({
    currentProcessId: input.currentProcessId ?? process.pid,
    liveAttestation,
    request,
  });
  if (decision.kind === "idle" || decision.kind === "recovery_required") {
    return decision;
  }
  if (decision.kind === "launch_coordinator") {
    const launch =
      input.runtime?.launchCoordinator ??
      (async (launchInput) =>
        await new NodeComputerUpgradeCoordinatorLauncher({
          argumentPrefix: input.argumentPrefix ?? ["__computer-upgrade"],
          executablePath: input.executablePath,
        }).launch(launchInput));
    const launched = await launch({
      configurationPath: input.configurationPath,
      requestPath: input.configuration.requestPath,
    });
    return Object.freeze({
      kind: "coordinator_launched",
      operationId: decision.operationId,
      processId: launched.processId,
    });
  }
  const acknowledge =
    input.runtime?.acknowledgeSuccessor ??
    acknowledgeNodeKCarrierComputerUpgradeSuccessor;
  const acknowledged = await acknowledge(input.configuration, decision.ready);
  if (
    acknowledged.kind !== "ready_acknowledged" ||
    acknowledged.operationId !== decision.ready.operationId
  ) {
    throw new Error("successor startup ready was not terminally acknowledged");
  }
  return Object.freeze({
    kind: "successor_acknowledged",
    operationId: acknowledged.operationId,
  });
}

/**
 * Pure launchd/service-start decision. Durable request identity and the live
 * singleton are the only inputs: K's runner owns transaction recovery after
 * a source relaunch, while a target process may only finish its own ready.
 */
export function planComputerUpgradeStartupRecovery(
  input: Readonly<{
    currentProcessId: number;
    liveAttestation: ComputerServiceReplacementAttestation;
    request: ComputerUpgradeCoordinatorRequest | null;
  }>,
): ComputerUpgradeStartupRecoveryDecision {
  if (
    !Number.isSafeInteger(input.currentProcessId) ||
    input.currentProcessId <= 0 ||
    input.liveAttestation.candidateProcessId !== input.currentProcessId
  ) {
    return recoveryRequired("singleton_process_mismatch");
  }
  const request = input.request;
  if (request === null) return Object.freeze({ kind: "idle" });
  if (!sameManagedAttachments(input.liveAttestation, request)) {
    return recoveryRequired("managed_attachment_mismatch");
  }
  if (input.liveAttestation.buildVersion === request.sourceBuildVersion) {
    return Object.freeze({
      kind: "launch_coordinator",
      operationId: request.operationId,
    });
  }
  if (
    input.liveAttestation.buildVersion === request.targetBuildVersion &&
    input.liveAttestation.candidateComputerInstanceId !==
      request.sourceComputerInstanceId
  ) {
    return Object.freeze({
      kind: "acknowledge_successor",
      ready: Object.freeze({
        observedBuildVersion: request.targetBuildVersion,
        operationId: request.operationId,
        successorComputerInstanceId:
          input.liveAttestation.candidateComputerInstanceId,
      }),
    });
  }
  return recoveryRequired("unexpected_service_identity");
}

function sameManagedAttachments(
  live: ComputerServiceReplacementAttestation,
  request: ComputerUpgradeCoordinatorRequest,
): boolean {
  const expectedKeys = Object.keys(request.managedAttachmentIdentities).sort();
  const liveKeys = Object.keys(live.managedAttachmentIdentities).sort();
  if (
    expectedKeys.length !== liveKeys.length ||
    expectedKeys.some((key, index) => key !== liveKeys[index]) ||
    live.managedAttachmentIds.length !== expectedKeys.length ||
    live.managedAttachmentIds.some((key, index) => key !== expectedKeys[index])
  ) {
    return false;
  }
  return expectedKeys.every(
    (key) =>
      live.managedAttachmentIdentities[key] ===
      request.managedAttachmentIdentities[key],
  );
}

function recoveryRequired(
  failureCode: ComputerUpgradeStartupRecoveryFailureCode,
): ComputerUpgradeStartupRecoveryDecision {
  return Object.freeze({ failureCode, kind: "recovery_required" });
}
