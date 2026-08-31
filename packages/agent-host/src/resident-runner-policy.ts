export type ResidentRunnerLifecycle =
  | "stopped"
  | "recovering"
  | "starting"
  | "running"
  | "stopping"
  | "crashed"
  | "degraded";

export type ResidentRunnerExitClass =
  "graceful" | "crash" | "configuration" | "attachment_revoked";

export type ResidentRunnerDegradedReason =
  "crash_budget_exhausted" | "configuration" | "attachment_revoked";

export const RESIDENT_RUNNER_CONTROL_PROTOCOL =
  "rah-resident-runner-control-v1";

export type ResidentRunnerControlDescriptor = Readonly<{
  controlToken: string;
  instanceId: string;
  protocol: typeof RESIDENT_RUNNER_CONTROL_PROTOCOL;
}>;

export type ResidentRunnerState = Readonly<{
  crashTimestampsMs: readonly number[];
  degradedReason: ResidentRunnerDegradedReason | undefined;
  desired: boolean;
  lifecycle: ResidentRunnerLifecycle;
  processControl: ResidentRunnerControlDescriptor | undefined;
  processGeneration: number;
  processId: number | undefined;
  retryAtMs: number | undefined;
}>;

export type ResidentRunnerEvent =
  | Readonly<{
      desired: boolean;
      kind: "reconcile";
      nowMs: number;
    }>
  | Readonly<{
      kind: "connection_confirmed";
      processGeneration: number;
    }>
  | Readonly<
      | {
          kind: "recovery_resolved";
          processGeneration: number;
          resolution: "absent";
        }
      | {
          kind: "recovery_resolved";
          processGeneration: number;
          processId: number;
          resolution: "connected" | "prepared";
        }
    >
  | Readonly<{
      kind: "process_prepared";
      processControl: ResidentRunnerControlDescriptor;
      processGeneration: number;
      processId: number;
    }>
  | Readonly<{
      kind: "process_observed";
      processGeneration: number;
      processId: number;
    }>
  | Readonly<{
      exitClass: ResidentRunnerExitClass;
      kind: "process_exit";
      nowMs: number;
      processGeneration: number;
    }>
  | Readonly<{
      kind: "operator_reset";
      nowMs: number;
    }>;

export type ResidentRunnerEffect = Readonly<
  | { kind: "spawn"; processGeneration: number }
  | { kind: "stop"; processGeneration: number }
>;

export type ResidentRunnerTransition = Readonly<{
  effect: ResidentRunnerEffect | null;
  state: ResidentRunnerState;
}>;

export type ResidentRunnerPolicyOptions = Readonly<{
  crashThreshold?: number;
  crashWindowMs?: number;
  restartBackoffMs?: number;
}>;

export type ResidentRunnerExitObservation = Readonly<{
  code: number | null;
  reason?: "configuration" | "attachment_revoked";
  signal: string | null;
}>;

const DEFAULT_CRASH_THRESHOLD = 3;
const DEFAULT_CRASH_WINDOW_MS = 60_000;
const DEFAULT_RESTART_BACKOFF_MS = 2_000;

/**
 * Pure policy for a resident Computer runner supervised by AgentHost.
 *
 * The visible lifecycle cases are conformance-derived from the authorized
 * Raft Computer 1.0.18 service. RAH keeps this reducer transport-neutral and
 * adds an explicit process-generation fence so late child events cannot
 * mutate a replacement runner.
 */
export function createResidentRunnerState(): ResidentRunnerState {
  return freezeState({
    crashTimestampsMs: [],
    degradedReason: undefined,
    desired: false,
    lifecycle: "stopped",
    processControl: undefined,
    processGeneration: 0,
    processId: undefined,
    retryAtMs: undefined,
  });
}

export function recoverResidentRunnerState(
  persisted: ResidentRunnerState,
): ResidentRunnerState {
  assertState(persisted);
  if (
    persisted.lifecycle === "starting" &&
    persisted.processControl === undefined &&
    persisted.processId === undefined
  ) {
    return freezeState({
      ...persisted,
      lifecycle: "stopped",
      retryAtMs: undefined,
    });
  }
  if (
    persisted.lifecycle !== "starting" &&
    persisted.lifecycle !== "running" &&
    persisted.lifecycle !== "stopping"
  ) {
    return freezeState(persisted);
  }
  return freezeState({
    ...persisted,
    lifecycle: "recovering",
    retryAtMs: undefined,
  });
}

export function classifyResidentRunnerExit(
  observation: ResidentRunnerExitObservation,
): ResidentRunnerExitClass {
  if (
    observation.code !== null &&
    (!Number.isSafeInteger(observation.code) || observation.code < 0)
  ) {
    throw new Error("exit code must be null or a non-negative safe integer");
  }
  if (observation.signal !== null && observation.signal.trim().length === 0) {
    throw new Error("exit signal must be null or a non-empty string");
  }
  if (observation.reason !== undefined) return observation.reason;
  if (
    observation.signal === "SIGINT" ||
    observation.signal === "SIGTERM" ||
    observation.code === 0
  ) {
    return "graceful";
  }
  return "crash";
}

export function reduceResidentRunner(
  current: ResidentRunnerState,
  event: ResidentRunnerEvent,
  options: ResidentRunnerPolicyOptions = {},
): ResidentRunnerTransition {
  const policy = normalizeOptions(options);
  assertState(current);

  if (event.kind === "connection_confirmed") {
    assertGeneration(event.processGeneration);
    if (
      current.lifecycle !== "starting" ||
      event.processGeneration !== current.processGeneration
    ) {
      return transition(current);
    }
    return transition({
      ...current,
      lifecycle: "running",
      retryAtMs: undefined,
    });
  }

  if (event.kind === "recovery_resolved") {
    assertGeneration(event.processGeneration);
    if (
      current.lifecycle !== "recovering" ||
      event.processGeneration !== current.processGeneration
    ) {
      return transition(current);
    }
    if (event.resolution !== "absent") assertProcessId(event.processId);
    return transition({
      ...current,
      lifecycle:
        event.resolution === "connected"
          ? "running"
          : event.resolution === "prepared"
            ? "starting"
            : "stopped",
      processControl:
        event.resolution === "absent" ? undefined : current.processControl,
      processId: event.resolution === "absent" ? undefined : event.processId,
      retryAtMs: undefined,
    });
  }

  if (event.kind === "process_observed") {
    assertGeneration(event.processGeneration);
    assertProcessId(event.processId);
    if (
      current.lifecycle !== "starting" ||
      event.processGeneration !== current.processGeneration
    ) {
      return transition(current);
    }
    return transition({ ...current, processId: event.processId });
  }

  if (event.kind === "process_prepared") {
    assertGeneration(event.processGeneration);
    assertProcessId(event.processId);
    assertControlDescriptor(event.processControl);
    if (
      current.lifecycle !== "starting" ||
      event.processGeneration !== current.processGeneration ||
      current.processId !== undefined ||
      current.processControl !== undefined
    ) {
      return transition(current);
    }
    return transition({
      ...current,
      processControl: event.processControl,
      processId: event.processId,
    });
  }

  assertTimestamp(event.nowMs, "nowMs");
  if (event.kind === "operator_reset") {
    if (current.lifecycle !== "degraded") return transition(current);
    return transition({
      ...current,
      crashTimestampsMs: [],
      degradedReason: undefined,
      lifecycle: "stopped",
      processControl: undefined,
      processId: undefined,
      retryAtMs: undefined,
    });
  }

  if (event.kind === "process_exit") {
    assertGeneration(event.processGeneration);
    if (
      event.processGeneration !== current.processGeneration ||
      !["recovering", "starting", "running", "stopping"].includes(
        current.lifecycle,
      )
    ) {
      return transition(current);
    }
    if (current.lifecycle === "stopping" || !current.desired) {
      return transition({
        ...current,
        lifecycle: "stopped",
        processControl: undefined,
        processId: undefined,
        retryAtMs: undefined,
      });
    }
    if (event.exitClass === "configuration") {
      return degraded(current, "configuration");
    }
    if (event.exitClass === "attachment_revoked") {
      return degraded(current, "attachment_revoked");
    }
    if (event.exitClass === "graceful") {
      return transition({
        ...current,
        lifecycle: "stopped",
        processControl: undefined,
        processId: undefined,
        retryAtMs: event.nowMs + policy.restartBackoffMs,
      });
    }

    const cutoff = event.nowMs - policy.crashWindowMs;
    const crashTimestampsMs = [
      ...current.crashTimestampsMs.filter(
        (timestamp) => timestamp >= cutoff && timestamp <= event.nowMs,
      ),
      event.nowMs,
    ];
    if (crashTimestampsMs.length >= policy.crashThreshold) {
      return transition({
        ...current,
        crashTimestampsMs,
        degradedReason: "crash_budget_exhausted",
        lifecycle: "degraded",
        processId: undefined,
        retryAtMs: undefined,
      });
    }
    return transition({
      ...current,
      crashTimestampsMs,
      lifecycle: "crashed",
      processControl: undefined,
      processId: undefined,
      retryAtMs: event.nowMs + policy.restartBackoffMs,
    });
  }

  const crashTimestampsMs = current.crashTimestampsMs.filter(
    (timestamp) =>
      timestamp >= event.nowMs - policy.crashWindowMs &&
      timestamp <= event.nowMs,
  );
  const state = freezeState({
    ...current,
    crashTimestampsMs,
    desired: event.desired,
  });
  if (!event.desired) {
    if (state.lifecycle === "starting" || state.lifecycle === "running") {
      return transition(
        { ...state, lifecycle: "stopping", retryAtMs: undefined },
        { kind: "stop", processGeneration: state.processGeneration },
      );
    }
    if (state.lifecycle === "crashed") {
      return transition({
        ...state,
        lifecycle: "stopped",
        retryAtMs: undefined,
      });
    }
    return transition(state);
  }
  if (
    (state.lifecycle === "stopped" || state.lifecycle === "crashed") &&
    (state.retryAtMs === undefined || event.nowMs >= state.retryAtMs)
  ) {
    const processGeneration = state.processGeneration + 1;
    return transition(
      {
        ...state,
        degradedReason: undefined,
        lifecycle: "starting",
        processControl: undefined,
        processGeneration,
        processId: undefined,
        retryAtMs: undefined,
      },
      { kind: "spawn", processGeneration },
    );
  }
  return transition(state);
}

function degraded(
  state: ResidentRunnerState,
  reason: ResidentRunnerDegradedReason,
): ResidentRunnerTransition {
  return transition({
    ...state,
    degradedReason: reason,
    lifecycle: "degraded",
    processControl: undefined,
    processId: undefined,
    retryAtMs: undefined,
  });
}

function transition(
  state: ResidentRunnerState,
  effect: ResidentRunnerEffect | null = null,
): ResidentRunnerTransition {
  return Object.freeze({ effect, state: freezeState(state) });
}

function freezeState(state: ResidentRunnerState): ResidentRunnerState {
  return Object.freeze({
    ...state,
    crashTimestampsMs: Object.freeze([...state.crashTimestampsMs]),
    processControl:
      state.processControl === undefined
        ? undefined
        : Object.freeze({ ...state.processControl }),
  });
}

function normalizeOptions(
  options: ResidentRunnerPolicyOptions,
): Required<ResidentRunnerPolicyOptions> {
  return {
    crashThreshold: positiveInteger(
      options.crashThreshold ?? DEFAULT_CRASH_THRESHOLD,
      "crashThreshold",
    ),
    crashWindowMs: positiveInteger(
      options.crashWindowMs ?? DEFAULT_CRASH_WINDOW_MS,
      "crashWindowMs",
    ),
    restartBackoffMs: positiveInteger(
      options.restartBackoffMs ?? DEFAULT_RESTART_BACKOFF_MS,
      "restartBackoffMs",
    ),
  };
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function assertGeneration(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("processGeneration must be a non-negative safe integer");
  }
}

function assertProcessId(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("processId must be a positive safe integer");
  }
}

function assertTimestamp(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertState(state: ResidentRunnerState): void {
  assertGeneration(state.processGeneration);
  if (state.processControl !== undefined) {
    assertControlDescriptor(state.processControl);
  }
  if (state.processId !== undefined) assertProcessId(state.processId);
  if (state.retryAtMs !== undefined) {
    assertTimestamp(state.retryAtMs, "retryAtMs");
  }
  for (const timestamp of state.crashTimestampsMs) {
    assertTimestamp(timestamp, "crash timestamp");
  }
}

function assertControlDescriptor(value: ResidentRunnerControlDescriptor): void {
  if (
    value.protocol !== RESIDENT_RUNNER_CONTROL_PROTOCOL ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value.instanceId,
    ) ||
    !/^[0-9a-f]{64}$/u.test(value.controlToken)
  ) {
    throw new Error("Resident Runner control descriptor is invalid");
  }
}
