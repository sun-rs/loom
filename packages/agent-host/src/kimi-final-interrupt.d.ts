import type { CodexFinalInterruptReport } from "./codex-final-interrupt.js";

export type KimiFinalInterruptReport = CodexFinalInterruptReport;
export function createKimiFinalInterrupt(options: { interrupt: () => void }): {
  readonly armed: boolean;
  readonly issued: boolean;
  readonly toolsInFlight: number;
  observe(update: unknown): void;
  arm(): boolean;
  settle(stopReason: string | undefined): void;
  report(): KimiFinalInterruptReport;
};
