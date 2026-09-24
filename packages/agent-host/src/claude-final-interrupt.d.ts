import type { CodexFinalInterruptReport } from "./codex-final-interrupt.js";

export type ClaudeFinalInterruptReport = CodexFinalInterruptReport;
export function isAbortedClaudeResult(frame: unknown): boolean;
export function createClaudeFinalInterrupt(options: {
  interrupt: () => Promise<unknown>;
}): {
  readonly armed: boolean;
  readonly issued: boolean;
  readonly toolsInFlight: number;
  observe(frame: Record<string, unknown>): void;
  arm(): boolean;
  report(): Promise<ClaudeFinalInterruptReport>;
};
