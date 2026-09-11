import type { AuthenticatedHostContext, RoomKernel } from "@rah-os/kernel";

type HostInput<Method extends (host: never, input: never) => unknown> =
  Parameters<Method>[1];
type HostResult<Method extends (host: never, input: never) => unknown> =
  ReturnType<Method>;

/**
 * The transport-neutral authority used by AgentHost. The port contains only
 * Host lifecycle and execution mutations; it cannot perform Human or Worker
 * business commands and therefore cannot become a second Room truth owner.
 */
export type AgentHostControlPort = {
  acquireAgentExclusiveOperationLease?(
    input: HostInput<RoomKernel["acquireAgentExclusiveOperationLease"]>,
  ): Promise<HostResult<RoomKernel["acquireAgentExclusiveOperationLease"]>>;
  appendRunTrajectory(
    input: HostInput<RoomKernel["appendRunTrajectory"]>,
  ): Promise<HostResult<RoomKernel["appendRunTrajectory"]>>;
  claimNextPlacement(
    input: HostInput<RoomKernel["claimNextPlacement"]>,
  ): Promise<HostResult<RoomKernel["claimNextPlacement"]>>;
  completeActivation(
    input: HostInput<RoomKernel["completeActivation"]>,
  ): Promise<HostResult<RoomKernel["completeActivation"]>>;
  createRunAttempt(
    input: HostInput<RoomKernel["createRunAttempt"]>,
  ): Promise<HostResult<RoomKernel["createRunAttempt"]>>;
  finishRunAttempt(
    input: HostInput<RoomKernel["finishRunAttempt"]>,
  ): Promise<HostResult<RoomKernel["finishRunAttempt"]>>;
  heartbeatHost(
    input: HostInput<RoomKernel["heartbeatHost"]>,
  ): Promise<HostResult<RoomKernel["heartbeatHost"]>>;
  leaseNextActivation(
    input: HostInput<RoomKernel["leaseNextActivation"]>,
  ): Promise<HostResult<RoomKernel["leaseNextActivation"]>>;
  leaseNextRuntimeRecovery(
    input: HostInput<RoomKernel["leaseNextRuntimeRecovery"]>,
  ): Promise<HostResult<RoomKernel["leaseNextRuntimeRecovery"]>>;
  markRunAttemptRunning(
    input: HostInput<RoomKernel["markRunAttemptRunning"]>,
  ): Promise<HostResult<RoomKernel["markRunAttemptRunning"]>>;
  prepareRunAttemptRuntime(
    input: HostInput<RoomKernel["prepareRunAttemptRuntime"]>,
  ): Promise<HostResult<RoomKernel["prepareRunAttemptRuntime"]>>;
  quarantineActivation(
    input: HostInput<RoomKernel["quarantineActivation"]>,
  ): Promise<HostResult<RoomKernel["quarantineActivation"]>>;
  recordRecoveredRuntimeTermination(
    input: HostInput<RoomKernel["recordRecoveredRuntimeTermination"]>,
  ): Promise<HostResult<RoomKernel["recordRecoveredRuntimeTermination"]>>;
  recordRuntimeTermination(
    input: HostInput<RoomKernel["recordRuntimeTermination"]>,
  ): Promise<HostResult<RoomKernel["recordRuntimeTermination"]>>;
  readPendingRuntimeNotice?(
    input: HostInput<RoomKernel["readPendingRuntimeNotice"]>,
  ): Promise<HostResult<RoomKernel["readPendingRuntimeNotice"]>>;
  renewActivationLease(
    input: HostInput<RoomKernel["renewActivationLease"]>,
  ): Promise<HostResult<RoomKernel["renewActivationLease"]>>;
  renewAgentExclusiveOperationLease?(
    input: HostInput<RoomKernel["renewAgentExclusiveOperationLease"]>,
  ): Promise<HostResult<RoomKernel["renewAgentExclusiveOperationLease"]>>;
  renewRuntimeRecoveryLease(
    input: HostInput<RoomKernel["renewRuntimeRecoveryLease"]>,
  ): Promise<HostResult<RoomKernel["renewRuntimeRecoveryLease"]>>;
  resolveActivationCancellation(
    input: HostInput<RoomKernel["resolveActivationCancellation"]>,
  ): Promise<HostResult<RoomKernel["resolveActivationCancellation"]>>;
  resolveActivationQuarantine(
    input: HostInput<RoomKernel["resolveActivationQuarantine"]>,
  ): Promise<HostResult<RoomKernel["resolveActivationQuarantine"]>>;
  retryActivation(
    input: HostInput<RoomKernel["retryActivation"]>,
  ): Promise<HostResult<RoomKernel["retryActivation"]>>;
  retryRuntimeRecovery(
    input: HostInput<RoomKernel["retryRuntimeRecovery"]>,
  ): Promise<HostResult<RoomKernel["retryRuntimeRecovery"]>>;
  releaseAgentExclusiveOperationLease?(
    input: HostInput<RoomKernel["releaseAgentExclusiveOperationLease"]>,
  ): Promise<HostResult<RoomKernel["releaseAgentExclusiveOperationLease"]>>;
  scheduleNextPlacement(
    input: Parameters<RoomKernel["scheduleNextPlacement"]>[0],
  ): Promise<ReturnType<RoomKernel["scheduleNextPlacement"]>>;
};

export function createKernelAgentHostControlPort(
  kernel: RoomKernel,
  host: AuthenticatedHostContext,
): AgentHostControlPort {
  return Object.freeze({
    acquireAgentExclusiveOperationLease: async (input) =>
      kernel.acquireAgentExclusiveOperationLease(host, input),
    appendRunTrajectory: async (input) =>
      kernel.appendRunTrajectory(host, input),
    claimNextPlacement: async (input) => kernel.claimNextPlacement(host, input),
    completeActivation: async (input) => kernel.completeActivation(host, input),
    createRunAttempt: async (input) => kernel.createRunAttempt(host, input),
    finishRunAttempt: async (input) => kernel.finishRunAttempt(host, input),
    heartbeatHost: async (input) => kernel.heartbeatHost(host, input),
    leaseNextActivation: async (input) =>
      kernel.leaseNextActivation(host, input),
    leaseNextRuntimeRecovery: async (input) =>
      kernel.leaseNextRuntimeRecovery(host, input),
    markRunAttemptRunning: async (input) =>
      kernel.markRunAttemptRunning(host, input),
    prepareRunAttemptRuntime: async (input) =>
      kernel.prepareRunAttemptRuntime(host, input),
    quarantineActivation: async (input) =>
      kernel.quarantineActivation(host, input),
    recordRecoveredRuntimeTermination: async (input) =>
      kernel.recordRecoveredRuntimeTermination(host, input),
    recordRuntimeTermination: async (input) =>
      kernel.recordRuntimeTermination(host, input),
    readPendingRuntimeNotice: async (input) =>
      kernel.readPendingRuntimeNotice(host, input),
    renewActivationLease: async (input) =>
      kernel.renewActivationLease(host, input),
    renewAgentExclusiveOperationLease: async (input) =>
      kernel.renewAgentExclusiveOperationLease(host, input),
    renewRuntimeRecoveryLease: async (input) =>
      kernel.renewRuntimeRecoveryLease(host, input),
    resolveActivationCancellation: async (input) =>
      kernel.resolveActivationCancellation(host, input),
    resolveActivationQuarantine: async (input) =>
      kernel.resolveActivationQuarantine(host, input),
    retryActivation: async (input) => kernel.retryActivation(host, input),
    retryRuntimeRecovery: async (input) =>
      kernel.retryRuntimeRecovery(host, input),
    releaseAgentExclusiveOperationLease: async (input) =>
      kernel.releaseAgentExclusiveOperationLease(host, input),
    scheduleNextPlacement: async (input) => kernel.scheduleNextPlacement(input),
  });
}
