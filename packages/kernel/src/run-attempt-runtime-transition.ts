import { text, type Row } from "./sqlite-row.ts";

export type RunAttemptRuntimeStartTransition =
  "invalid_run_state" | "missing_prepared_runtime" | "ready" | "replay";

/** Classifies a distributed run.start retry without mutating canonical state. */
export function classifyRunAttemptRuntimeStart(input: {
  hostId: string;
  recoveryDescriptorJson: string;
  recoveryDriver: string;
  runAttemptState: string;
  runtimeProcess: Row | undefined;
  runtimeRunId: string;
}): RunAttemptRuntimeStartTransition {
  const runtime = input.runtimeProcess;
  const matches =
    runtime !== undefined &&
    text(runtime, "launch_host_id") === input.hostId &&
    text(runtime, "runtime_run_id") === input.runtimeRunId &&
    text(runtime, "recovery_driver") === input.recoveryDriver &&
    text(runtime, "recovery_descriptor_json") === input.recoveryDescriptorJson;
  if (
    input.runAttemptState === "running" &&
    matches &&
    text(runtime, "state") === "active"
  ) {
    return "replay";
  }
  if (input.runAttemptState !== "starting") return "invalid_run_state";
  return matches && text(runtime, "state") === "prepared"
    ? "ready"
    : "missing_prepared_runtime";
}
