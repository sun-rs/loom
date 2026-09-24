import type { CodexFinalInterruptReport } from "./codex-final-interrupt.js";

export type ClaudeFinalInterruptReport = CodexFinalInterruptReport;
export function isAbortedClaudeResult(
  frame: unknown,
  options?: { interruptAcknowledged?: boolean },
): boolean;
export function createClaudeFinalInterrupt(options: {
  interrupt: () => Promise<unknown>;
}): {
  readonly armed: boolean;
  readonly issued: boolean;
  readonly toolsInFlight: number;
  observe(frame: Record<string, unknown>): void;
  endedByInterrupt(frame: Record<string, unknown>): boolean;
  arm(): boolean;
  report(): Promise<ClaudeFinalInterruptReport>;
};
