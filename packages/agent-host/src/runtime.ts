import type {
  Activation,
  AgentRuntimeContext,
  ContextManifest,
  RuntimeRecoveryDescriptor,
  RuntimeTrajectoryAppendInput,
  RuntimeFailure,
  RunAttemptUsageGapRecordInput,
  RunAttemptUsageRecordInput,
} from "@rah-os/protocol";

export type RuntimeAvailability = {
  available: boolean;
  detail?: string;
};

export type ActivationEnvelope = Pick<
  Activation,
  "activationId" | "fromSeq" | "participantId" | "reason" | "roomId" | "toSeq"
> & {
  agent?: AgentRuntimeContext;
  contextManifest?: ContextManifest;
  consumerId: string;
  hostId: string;
  runAttemptId: string;
  /**
   * S2-0: one short Host line for the next wake (what leftover-process
   * cleanup killed or released). Delivered once; never Room content.
   */
  runtimeNotice?: string;
};

export type RunHandle = {
  recoveryDescriptor?: RuntimeRecoveryDescriptor;
  runId: string;
};

export type RunExit = {
  code: number | null;
  failure?: RuntimeFailure;
  signal?: string;
};

export type RuntimeRecoveryInput = {
  recoveryDescriptor: RuntimeRecoveryDescriptor;
  runAttemptId: string;
  runtimeRunId: string;
};

export type RuntimeStartLifecycle = {
  recordTrajectory?(activity: RuntimeTrajectoryAppendInput): Promise<void>;
  /** Native per-generation token usage; diagnostics, never trajectory. */
  recordUsage?(usage: RunAttemptUsageRecordInput): Promise<void>;
  /** A usage capture gap: the RunAttempt's usage is partial or unavailable. */
  recordUsageGap?(gap: RunAttemptUsageGapRecordInput): Promise<void>;
  /**
   * S1-f: a Role instance's native session binding was persisted by the Host.
   * Durable Kernel evidence; its absence means a later launch starts fresh.
   */
  recordInstanceSessionBinding?(input: {
    runAttemptId: string;
    runtimeRunId: string;
  }): Promise<void>;
  registerPrepared(run: RunHandle): Promise<void>;
};

export type RuntimeBusyNotice = {
  fingerprint: string;
  text: string;
  eventIds?: readonly string[];
};

export interface RuntimeAdapter {
  readonly busyInputMode?: "direct" | "gated" | undefined;
  readonly guideRuntimeId?: string | undefined;
  readonly busyInputSupported?: boolean;
  /** Transport acceptance only; never acknowledges canonical Inbox or work. */
  notifyBusy?(run: RunHandle, notice: RuntimeBusyNotice): Promise<boolean>;
  readonly recoveryDrivers?: readonly string[];
  probe(): Promise<RuntimeAvailability>;
  /** Liveness only, never delivery/completion or process-group terminal proof. */
  isAlive?(run: RunHandle): Promise<boolean>;
  start(
    input: ActivationEnvelope,
    lifecycle: RuntimeStartLifecycle,
  ): Promise<RunHandle>;
  cancel(run: RunHandle): Promise<RunExit>;
  reap(run: RunHandle): Promise<RunExit>;
  recover?(input: RuntimeRecoveryInput): Promise<RunExit>;
}

export type RuntimeDeliveryMode = "wait" | "direct" | "gated";
/** One effective-mode rule for Host admission and daemon prompt composition. */
export function resolveRuntimeDeliveryMode(
  runtime: RuntimeAdapter,
  guideEnabled: boolean,
): RuntimeDeliveryMode {
  return guideEnabled &&
    runtime.busyInputSupported === true &&
    runtime.notifyBusy
    ? (runtime.busyInputMode ?? "wait")
    : "wait";
}
