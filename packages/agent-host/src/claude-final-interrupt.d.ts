import type { CodexFinalInterruptReport } from "./codex-final-interrupt.js";

export type ClaudeFinalInterruptReport = CodexFinalInterruptReport;
export const LEGACY_RECEIPT_GRACE_MS: number;
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
  awaitsReceipt(frame: Record<string, unknown>): boolean;
  endedByInterruptAfterReceipt(
    frame: Record<string, unknown>,
  ): Promise<boolean>;
  arm(): boolean;
  report(): Promise<ClaudeFinalInterruptReport>;
};
