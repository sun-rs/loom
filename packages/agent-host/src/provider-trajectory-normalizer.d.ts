import type { RuntimeTrajectoryEntry } from "@rah-os/protocol";

export type NormalizedRuntimeTrajectory = Readonly<{
  entry: RuntimeTrajectoryEntry;
  observedAt: string;
}>;

export function normalizeCodexTrajectoryNotification(
  frame: unknown,
  now?: () => number,
): readonly NormalizedRuntimeTrajectory[];

export function normalizeKimiTrajectoryNotification(
  frame: unknown,
  activeSessionId: string | undefined,
  now?: () => number,
): readonly NormalizedRuntimeTrajectory[];

export function normalizeClaudeTrajectoryEvent(
  frame: unknown,
  now?: () => number,
): readonly NormalizedRuntimeTrajectory[];

export function normalizeOpenCodeTrajectoryEvent(
  frame: unknown,
  activeSessionId: string,
  now?: () => number,
): readonly NormalizedRuntimeTrajectory[];

export function kimiPromptCompletionTrajectory(
  stopReason: unknown,
  now?: () => number,
): readonly NormalizedRuntimeTrajectory[];

export function runtimeStatusTrajectory(
  activity: "error" | "offline" | "online" | "thinking" | "working",
  detailKind:
    "model_request_started" | "runtime_error" | "starting" | "stopped",
  detail: string,
  producerFactId: string,
  now?: () => number,
): readonly NormalizedRuntimeTrajectory[];

export class RuntimeTrajectoryWriter {
  constructor(write?: (value: string) => void);
  emit(records: readonly NormalizedRuntimeTrajectory[]): void;
  flush(): void;
}
