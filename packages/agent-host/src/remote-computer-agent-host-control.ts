import type {
  ComputerRunAttempt,
  ComputerRuntimeProcess,
} from "@rah-os/computer-protocol";
import type {
  HostRecord,
  PlacementLaunchClaim,
  RunAttempt,
  RuntimeProcessRecord,
} from "@rah-os/kernel";

import type { AgentHostIdentity } from "./agent-host.ts";
import type { AgentHostControlPort } from "./agent-host-control.ts";
import { ComputerResidentService } from "./computer-resident-service.ts";

/**
 * Adapts the authenticated resident Computer session to the exact authority
 * consumed by AgentHost. Scheduling and orphan recovery remain Server-owned;
 * unsupported legacy paths fail closed instead of inventing local truth.
 */
export function createRemoteComputerAgentHostControlPort(
  resident: ComputerResidentService,
): AgentHostControlPort {
  return Object.freeze({
    appendRunTrajectory: async (input) => {
      const response = await resident.commandExecution({
        ...input,
        kind: "run.trajectory.append",
      });
      if (response.kind !== "run.trajectory.append") throw invalidResponse();
      return response.activity;
    },
    claimNextPlacement: async (input) => {
      const claim = (await resident.claimPlacement(input)).claim;
      return claim === null
        ? null
        : ({
            ...claim,
            runAttempt: toRunAttempt(claim.runAttempt),
          } satisfies PlacementLaunchClaim);
    },
    completeActivation: async (input) => {
      const response = await resident.commandExecution({
        activationId: input.activationId,
        consumerId: input.consumerId,
        kind: "activation.complete",
      });
      if (response.kind !== "activation.complete") throw invalidResponse();
      return response.activation;
    },
    createRunAttempt: async () => {
      throw unsupported("creating a RunAttempt without a Placement claim");
    },
    finishRunAttempt: async (input) => {
      const response = await resident.commandExecution({
        ...(input.error === undefined ? {} : { error: input.error }),
        ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
        ...(input.exitSignal === undefined
          ? {}
          : { exitSignal: input.exitSignal }),
        kind: "run.finish",
        runAttemptId: input.runAttemptId,
        state: input.state,
      });
      if (response.kind !== "run.finish") throw invalidResponse();
      return toRunAttempt(response.runAttempt);
    },
    heartbeatHost: async (input) => {
      const request = input ?? {};
      return toHostRecord(
        (
          await resident.heartbeatNow({
            ...(request.buildVersion === undefined
              ? {}
              : { buildVersion: request.buildVersion }),
            ...(request.processId === undefined
              ? {}
              : { processId: request.processId }),
            ...(request.protocolVersion === undefined
              ? {}
              : { protocolVersion: request.protocolVersion }),
            state: request.state ?? "online",
          })
        ).host,
      );
    },
    leaseNextActivation: async () => {
      throw unsupported("legacy Activation leasing");
    },
    leaseNextRuntimeRecovery: async () => {
      throw unsupported("remote orphan recovery");
    },
    markRunAttemptRunning: async (input) => {
      const response = await resident.commandExecution({
        kind: "run.start",
        recoveryDescriptor: input.recoveryDescriptor,
        runAttemptId: input.runAttemptId,
        runtimeRunId: input.runtimeRunId,
      });
      if (response.kind !== "run.start") throw invalidResponse();
      return toRunAttempt(response.runAttempt);
    },
    prepareRunAttemptRuntime: async (input) => {
      const response = await resident.commandExecution({
        kind: "runtime.prepare",
        recoveryDescriptor: input.recoveryDescriptor,
        runAttemptId: input.runAttemptId,
        runtimeRunId: input.runtimeRunId,
      });
      if (response.kind !== "runtime.prepare") throw invalidResponse();
      return toRuntimeProcess(response.runtimeProcess);
    },
    quarantineActivation: async (input) => {
      const response = await resident.commandExecution({
        activationId: input.activationId,
        error: input.error,
        kind: "activation.quarantine",
      });
      if (response.kind !== "activation.quarantine") throw invalidResponse();
      return response.activation;
    },
    recordRecoveredRuntimeTermination: async () => {
      throw unsupported("remote orphan terminal proof");
    },
    recordRuntimeTermination: async (input) => {
      const response = await resident.commandExecution({
        exit: {
          code: input.exit.code,
          ...(input.exit.signal === undefined
            ? {}
            : { signal: input.exit.signal }),
        },
        kind: "runtime.terminate",
        runAttemptId: input.runAttemptId,
        runtimeRunId: input.runtimeRunId,
      });
      if (response.kind !== "runtime.terminate") throw invalidResponse();
      return toRuntimeProcess(response.runtimeProcess);
    },
    renewActivationLease: async (input) => {
      const response = await resident.commandExecution({
        activationId: input.activationId,
        kind: "activation.renew",
        leaseMs: input.leaseMs,
      });
      if (response.kind !== "activation.renew") throw invalidResponse();
      return response.activation;
    },
    renewRuntimeRecoveryLease: async () => {
      throw unsupported("remote orphan recovery lease renewal");
    },
    resolveActivationCancellation: async (input) => {
      const response = await resident.commandExecution({
        activationId: input.activationId,
        kind: "activation.cancellation.resolve",
      });
      if (response.kind !== "activation.cancellation.resolve") {
        throw invalidResponse();
      }
      return response.activation;
    },
    resolveActivationQuarantine: async () => {
      throw unsupported("remote quarantine recovery");
    },
    retryActivation: async (input) => {
      const response = await resident.commandExecution({
        activationId: input.activationId,
        error: input.error,
        kind: "activation.retry",
        retryAfterMs: input.retryAfterMs,
      });
      if (response.kind !== "activation.retry") throw invalidResponse();
      return response.activation;
    },
    retryRuntimeRecovery: async () => {
      throw unsupported("remote orphan recovery retry");
    },
    // Placement scheduling is a Server concern. The resident only pulls a
    // decision that has already been committed by the canonical scheduler.
    scheduleNextPlacement: async () => null,
  });
}

export function requireRemoteComputerAgentHostIdentity(
  resident: ComputerResidentService,
): AgentHostIdentity {
  const snapshot = resident.snapshot();
  if (
    snapshot.state !== "connected" ||
    snapshot.hostId === undefined ||
    snapshot.hostInstanceId === undefined ||
    snapshot.participantIds === undefined ||
    snapshot.participantIds.length === 0
  ) {
    throw new Error(
      "Remote AgentHost identity requires a connected Computer session",
    );
  }
  return Object.freeze({
    hostId: snapshot.hostId,
    instanceId: snapshot.hostInstanceId,
    participantIds: Object.freeze([...snapshot.participantIds]),
  });
}

function unsupported(capability: string): Error {
  return new Error(`Computer control protocol does not support ${capability}`);
}

function invalidResponse(): Error {
  return new Error("Computer control returned the wrong execution response");
}

function toRunAttempt(input: ComputerRunAttempt): RunAttempt {
  return {
    activationId: input.activationId,
    attemptNumber: input.attemptNumber,
    ...(input.error === undefined ? {} : { error: input.error }),
    ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
    ...(input.exitSignal === undefined ? {} : { exitSignal: input.exitSignal }),
    ...(input.finishedAt === undefined ? {} : { finishedAt: input.finishedAt }),
    ...(input.contextManifest === undefined
      ? {}
      : { contextManifest: input.contextManifest }),
    hostId: input.hostId,
    participantId: input.participantId,
    ...(input.placement === undefined ? {} : { placement: input.placement }),
    roomId: input.roomId,
    runAttemptId: input.runAttemptId,
    ...(input.runtimeRunId === undefined
      ? {}
      : { runtimeRunId: input.runtimeRunId }),
    startedAt: input.startedAt,
    state: input.state,
  };
}

function toRuntimeProcess(input: ComputerRuntimeProcess): RuntimeProcessRecord {
  return {
    activationId: input.activationId,
    ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
    ...(input.exitSignal === undefined ? {} : { exitSignal: input.exitSignal }),
    launchHostId: input.launchHostId,
    participantId: input.participantId,
    recoveryAttemptCount: input.recoveryAttemptCount,
    recoveryDescriptor: input.recoveryDescriptor,
    ...(input.recoveryLastError === undefined
      ? {}
      : { recoveryLastError: input.recoveryLastError }),
    ...(input.recoveryLeaseOwner === undefined
      ? {}
      : { recoveryLeaseOwner: input.recoveryLeaseOwner }),
    ...(input.recoveryLeaseOwnerInstanceId === undefined
      ? {}
      : { recoveryLeaseOwnerInstanceId: input.recoveryLeaseOwnerInstanceId }),
    ...(input.recoveryLeaseUntil === undefined
      ? {}
      : { recoveryLeaseUntil: input.recoveryLeaseUntil }),
    registeredAt: input.registeredAt,
    roomId: input.roomId,
    runAttemptId: input.runAttemptId,
    runtimeProcessId: input.runtimeProcessId,
    runtimeRunId: input.runtimeRunId,
    state: input.state,
    ...(input.terminatedAt === undefined
      ? {}
      : { terminatedAt: input.terminatedAt }),
    updatedAt: input.updatedAt,
  };
}

function toHostRecord(
  input: Awaited<ReturnType<ComputerResidentService["heartbeatNow"]>>["host"],
): HostRecord {
  return {
    ...(input.buildVersion === undefined
      ? {}
      : { buildVersion: input.buildVersion }),
    hostId: input.hostId,
    instanceId: input.instanceId,
    lastSeenAt: input.lastSeenAt,
    participantIds: [...input.participantIds],
    ...(input.processId === undefined ? {} : { processId: input.processId }),
    ...(input.protocolVersion === undefined
      ? {}
      : { protocolVersion: input.protocolVersion }),
    state: input.state,
  };
}
