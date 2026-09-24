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
   * cleanup killed or released). Reserved for this RunAttempt and delivered
   * at least once (stable dedup id in the line); never Room content.
   */
  runtimeNotice?: string;
};

export type RunHandle = {
  /**
   * S2-a: `adapter` when the process tree outlives the run (a warm runtime);
   * its adapter sweeps leftovers when the process itself ends.
   */
  leftoverSweep?: "adapter" | "host";
  /** S2-a: the process-tree tag (`LOOM_RUNTIME_ID`) when it is not `runId`. */
  processTag?: string;
  recoveryDescriptor?: RuntimeRecoveryDescriptor;
  runId: string;
};

/**
 * S2-a `turn_quiesced` proof inputs (S2 spec §1/§2): the turn can no longer
 * act while its warm process lives on. Never an exit, ACK or success proof.
 */
export type TurnQuiescence = {
  closeSeq: number;
  inFlightToolCount: number;
  instanceRuntimeId: string;
  /** `null` only when the native runtime rejected the turn: nothing ran. */
  nativeTurnId: string | null;
  processGroupAlive: boolean;
  result: "success" | "error" | "cancelled";
};

export type RunExit = {
  /** `null` with `quiesced`: the process did not exit. */
  code: number | null;
  failure?: RuntimeFailure;
  /** Present instead of a physical exit when a warm turn quiesced. */
  quiesced?: TurnQuiescence;
  /**
   * S2-b: the Host ended this run (stall supervision) after its `final`
   * reply had committed. The obligation is not re-executed: the exit is
   * recorded as it was and the Activation completes if delivery is
   * acknowledged through `toSeq` (otherwise the normal retry applies).
   */
  finalReplyCommitted?: boolean;
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
  /**
   * S2-0 review P2-2: the runtime confirmed that the input it accepted
   * carried `runtimeNotice` verbatim (e.g. a digest-matched Codex turn/start
   * acceptance). Transport acceptance only, never "read" or "understood".
   */
  recordRuntimeNoticeAccepted?(): Promise<void>;
  /**
   * Final-reply turn end: the runtime's report of the native interrupt it
   * issued after the Host's final-reply signal. Diagnostics for the usage
   * read; never ACK, Task or completion evidence.
   */
  recordFinalReplyInterrupt?(input: {
    preemptedFollowUp: boolean | "unknown";
    runAttemptId: string;
    sent: boolean;
    requested?: boolean;
    accepted?: boolean | "unknown";
    terminal?: boolean | "unknown";
  }): Promise<void>;
  /** S2-b: the measured native session resume of this run's start. */
  recordSessionResume?(input: {
    runAttemptId: string;
    runtimeRunId: string;
    sessionResumeMs: number;
  }): Promise<void>;
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
  /**
   * Final-reply turn end: a `final` post of this run committed (the Host read
   * the Kernel marker). End the native turn at the next tool boundary instead
   * of letting the tool loop spend a full-context generation on "sent".
   * Returns false when unsupported or unavailable; the turn then runs on
   * unchanged. Never completes the Activation or acknowledges delivery.
   */
  interruptAfterFinalReply?(run: RunHandle): Promise<boolean>;
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
  /**
   * S2-a: called once per claimed RunAttempt after its Activation outcome is
   * durable (complete, retry, quarantine, cancel). A warm runtime releases
   * its lane here; per-turn runtimes do not implement it.
   */
  releaseTurn?(input: {
    participantId: string;
    runAttemptId: string;
  }): Promise<void>;
  /**
   * P2-3: called once after a claimed RunAttempt's Activation completed (the
   * model's delivery ACK reached the Activation head). A resumed session whose
   * wake carried the protocol-update line records the current protocol version
   * on its binding; any other run is a no-op.
   */
  acceptSessionProtocol?(input: {
    participantId: string;
    runAttemptId: string;
  }): Promise<void>;
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
