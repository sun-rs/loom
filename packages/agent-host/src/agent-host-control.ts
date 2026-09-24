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
  /** Registers "handed to the runtime" under the Host's own credential, after
   * the driver's acceptance signal. Never called on a write alone. */
  markPresentedDeliverySent(
    input: HostInput<RoomKernel["markPresentedDeliverySent"]>,
  ): Promise<void>;
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
  /** Native per-generation Provider usage, bound to the Host's own RunAttempt. */
  recordRunAttemptUsage?(
    input: Parameters<RoomKernel["runAttemptUsage"]["record"]>[1],
  ): Promise<ReturnType<RoomKernel["runAttemptUsage"]["record"]>>;
  recordRunAttemptUsageGap?(
    input: Parameters<RoomKernel["runAttemptUsage"]["recordGap"]>[1],
  ): Promise<ReturnType<RoomKernel["runAttemptUsage"]["recordGap"]>>;
  /** S2-0: one leftover-process sweep for one of this Host's participants. */
  recordRuntimeProcessCleanup?(
    input: Parameters<RoomKernel["runtimeProcessCleanup"]["record"]>[1],
  ): Promise<ReturnType<RoomKernel["runtimeProcessCleanup"]["record"]>>;
  readRuntimeCleanupAdmission?(
    input: Parameters<RoomKernel["runtimeProcessCleanup"]["admission"]>[1],
  ): Promise<ReturnType<RoomKernel["runtimeProcessCleanup"]["admission"]>>;
  /** S2-0 review: the runtime is due a sweep; blocks until one is recorded. */
  markRuntimeCleanupPending?(
    input: Parameters<RoomKernel["runtimeProcessCleanup"]["markPending"]>[1],
  ): Promise<void>;
  reserveRuntimeCleanupNotice?(
    input: Parameters<RoomKernel["runtimeProcessCleanup"]["reserveNotice"]>[1],
  ): Promise<ReturnType<RoomKernel["runtimeProcessCleanup"]["reserveNotice"]>>;
  acceptRuntimeCleanupNotice?(
    input: Parameters<RoomKernel["runtimeProcessCleanup"]["acceptNotice"]>[1],
  ): Promise<void>;
  releaseRuntimeCleanupNotice?(
    input: Parameters<RoomKernel["runtimeProcessCleanup"]["releaseNotice"]>[1],
  ): Promise<void>;
  resolveRuntimeCleanupTargets?(
    input: Parameters<
      RoomKernel["runtimeProcessCleanup"]["resolveRuntimes"]
    >[1],
  ): Promise<
    ReturnType<RoomKernel["runtimeProcessCleanup"]["resolveRuntimes"]>
  >;
  listRuntimeCleanupResweepTargets?(
    input: Parameters<RoomKernel["runtimeProcessCleanup"]["resweepTargets"]>[1],
  ): Promise<ReturnType<RoomKernel["runtimeProcessCleanup"]["resweepTargets"]>>;
  /** S2-a: the `turn_quiesced` proof of one warm turn. */
  recordTurnQuiesced?(
    input: Parameters<RoomKernel["instanceRuntimes"]["recordTurnQuiesced"]>[1],
  ): Promise<ReturnType<RoomKernel["instanceRuntimes"]["recordTurnQuiesced"]>>;
  /** S2-a: warm instance runtime lifetime facts (one owner: the Kernel). */
  instanceRuntimes?: InstanceRuntimeControl;
  /** S1-f: durable evidence that the Host persisted an instance binding. */
  recordInstanceSessionBinding?(
    input: Parameters<RoomKernel["instanceSessions"]["record"]>[1],
  ): Promise<ReturnType<RoomKernel["instanceSessions"]["record"]>>;
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

type InstanceRuntimeService = RoomKernel["instanceRuntimes"];
type ServiceInput<Name extends keyof InstanceRuntimeService> =
  InstanceRuntimeService[Name] extends (
    host: never,
    input: infer Input,
  ) => unknown
    ? Input
    : never;
type ServiceResult<Name extends keyof InstanceRuntimeService> =
  InstanceRuntimeService[Name] extends (...args: never[]) => infer Result
    ? Result
    : never;

export type InstanceRuntimeControl = {
  register(input: ServiceInput<"register">): Promise<ServiceResult<"register">>;
  markReady(
    input: ServiceInput<"markReady">,
  ): Promise<ServiceResult<"markReady">>;
  beginTurn(
    input: ServiceInput<"beginTurn">,
  ): Promise<ServiceResult<"beginTurn">>;
  recordTurnAccepted(input: ServiceInput<"recordTurnAccepted">): Promise<void>;
  recordLateTurnFrame(
    input: ServiceInput<"recordLateTurnFrame">,
  ): Promise<void>;
  releaseTurn(
    input: ServiceInput<"releaseTurn">,
  ): Promise<ServiceResult<"releaseTurn">>;
  recordExit(
    input: ServiceInput<"recordExit">,
  ): Promise<ServiceResult<"recordExit">>;
  list(): Promise<ServiceResult<"list">>;
  terminatedAmong(
    ids: readonly string[],
  ): Promise<ServiceResult<"terminatedAmong">>;
};

export function createKernelInstanceRuntimeControl(
  kernel: RoomKernel,
  host: AuthenticatedHostContext,
): InstanceRuntimeControl {
  const service = kernel.instanceRuntimes;
  return Object.freeze({
    register: async (input) => service.register(host, input),
    markReady: async (input) => service.markReady(host, input),
    beginTurn: async (input) => service.beginTurn(host, input),
    recordTurnAccepted: async (input) =>
      service.recordTurnAccepted(host, input),
    recordLateTurnFrame: async (input) =>
      service.recordLateTurnFrame(host, input),
    releaseTurn: async (input) => service.releaseTurn(host, input),
    recordExit: async (input) => service.recordExit(host, input),
    list: async () => service.list(host),
    terminatedAmong: async (ids) => service.terminatedAmong(host, ids),
  });
}

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
    markPresentedDeliverySent: async (input) =>
      kernel.markPresentedDeliverySent(host, input),
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
    recordRunAttemptUsage: async (input) =>
      kernel.runAttemptUsage.record(host, input),
    recordRunAttemptUsageGap: async (input) =>
      kernel.runAttemptUsage.recordGap(host, input),
    recordInstanceSessionBinding: async (input) =>
      kernel.instanceSessions.record(host, input),
    recordRuntimeProcessCleanup: async (input) =>
      kernel.runtimeProcessCleanup.record(host, input),
    readRuntimeCleanupAdmission: async (input) =>
      kernel.runtimeProcessCleanup.admission(host, input),
    markRuntimeCleanupPending: async (input) =>
      kernel.runtimeProcessCleanup.markPending(host, input),
    reserveRuntimeCleanupNotice: async (input) =>
      kernel.runtimeProcessCleanup.reserveNotice(host, input),
    acceptRuntimeCleanupNotice: async (input) =>
      kernel.runtimeProcessCleanup.acceptNotice(host, input),
    releaseRuntimeCleanupNotice: async (input) =>
      kernel.runtimeProcessCleanup.releaseNotice(host, input),
    resolveRuntimeCleanupTargets: async (input) =>
      kernel.runtimeProcessCleanup.resolveRuntimes(host, input),
    listRuntimeCleanupResweepTargets: async (input) =>
      kernel.runtimeProcessCleanup.resweepTargets(host, input),
    recordTurnQuiesced: async (input) =>
      kernel.instanceRuntimes.recordTurnQuiesced(host, input),
    instanceRuntimes: createKernelInstanceRuntimeControl(kernel, host),
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
