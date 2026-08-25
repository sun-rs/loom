import type { Activation, RuntimeRecoveryDescriptor } from "@rah-os/protocol";

export type RuntimeAvailability = {
  available: boolean;
  detail?: string;
};

export type ActivationEnvelope = Pick<
  Activation,
  "activationId" | "fromSeq" | "participantId" | "reason" | "roomId" | "toSeq"
> & {
  consumerId: string;
  hostId: string;
  runAttemptId: string;
};

export type RunHandle = {
  recoveryDescriptor?: RuntimeRecoveryDescriptor;
  runId: string;
};

export type RunExit = {
  code: number | null;
  signal?: string;
};

export type RuntimeRecoveryInput = {
  recoveryDescriptor: RuntimeRecoveryDescriptor;
  runAttemptId: string;
  runtimeRunId: string;
};

export type RuntimeStartLifecycle = {
  registerPrepared(run: RunHandle): Promise<void>;
};

export interface RuntimeAdapter {
  readonly recoveryDrivers?: readonly string[];
  probe(): Promise<RuntimeAvailability>;
  start(
    input: ActivationEnvelope,
    lifecycle: RuntimeStartLifecycle,
  ): Promise<RunHandle>;
  cancel(run: RunHandle): Promise<RunExit>;
  reap(run: RunHandle): Promise<RunExit>;
  recover?(input: RuntimeRecoveryInput): Promise<RunExit>;
}
