import type { RoomKernel } from "./room-kernel.ts";
import type {
  ComputerOperationAcknowledgeInput,
  ComputerOperationRecord,
  ComputerOperationStore,
} from "./computer-operation-store.ts";

export type ComputerApplicationPort = Pick<
  RoomKernel,
  | "authenticateHostAccessToken"
  | "appendRunTrajectory"
  | "claimNextPlacement"
  | "completeActivation"
  | "finishRunAttempt"
  | "heartbeatHost"
  | "listHostExecutionWorkspaceBindings"
  | "markRunAttemptRunning"
  | "prepareRunAttemptRuntime"
  | "publishRuntimeOffer"
  | "quarantineActivation"
  | "recordRuntimeTermination"
  | "resolveActivationCancellation"
  | "renewActivationLease"
  | "retryActivation"
> & {
  acknowledgeComputerOperation?(
    host: Parameters<ComputerOperationStore["acknowledge"]>[0],
    input: ComputerOperationAcknowledgeInput,
  ): ComputerOperationRecord;
  claimNextComputerOperation?(
    host: Parameters<ComputerOperationStore["claim"]>[0],
  ): ComputerOperationRecord | null;
};

export type ComputerApplicationPortOptions = {
  operations?: ComputerOperationStore;
};

export function createComputerApplicationPort(
  kernel: RoomKernel,
  options: ComputerApplicationPortOptions = {},
): ComputerApplicationPort {
  const port: ComputerApplicationPort = {
    ...(options.operations === undefined
      ? {}
      : {
          acknowledgeComputerOperation: (host, input) =>
            options.operations!.acknowledge(host, input),
          claimNextComputerOperation: (host) => options.operations!.claim(host),
        }),
    authenticateHostAccessToken: (accessToken) =>
      kernel.authenticateHostAccessToken(accessToken),
    appendRunTrajectory: (host, input) =>
      kernel.appendRunTrajectory(host, input),
    claimNextPlacement: (host, input) => kernel.claimNextPlacement(host, input),
    completeActivation: (host, input) => kernel.completeActivation(host, input),
    finishRunAttempt: (host, input) => kernel.finishRunAttempt(host, input),
    listHostExecutionWorkspaceBindings: (host) =>
      kernel.listHostExecutionWorkspaceBindings(host),
    heartbeatHost: (host, input) => kernel.heartbeatHost(host, input),
    markRunAttemptRunning: (host, input) =>
      kernel.markRunAttemptRunning(host, input),
    prepareRunAttemptRuntime: (host, input) =>
      kernel.prepareRunAttemptRuntime(host, input),
    publishRuntimeOffer: (host, offer) =>
      kernel.publishRuntimeOffer(host, offer),
    quarantineActivation: (host, input) =>
      kernel.quarantineActivation(host, input),
    recordRuntimeTermination: (host, input) =>
      kernel.recordRuntimeTermination(host, input),
    resolveActivationCancellation: (host, input) =>
      kernel.resolveActivationCancellation(host, input),
    renewActivationLease: (host, input) =>
      kernel.renewActivationLease(host, input),
    retryActivation: (host, input) => kernel.retryActivation(host, input),
  };
  return Object.freeze(port);
}
