import type { CodexFinalInterruptReport } from "./codex-final-interrupt.js";

export type OpenCodeFinalInterruptReport = CodexFinalInterruptReport;
export function createOpenCodeFinalInterrupt(options: {
  interrupt: () => Promise<unknown> | unknown;
  /** Tool parts of this run persisted as pending/running (listing check). */
  inFlightTools?: () => Promise<unknown[]>;
}): {
  readonly armed: boolean;
  readonly issued: boolean;
  readonly toolsInFlight: number;
  observePart(part: unknown): void;
  observeDelta(): void;
  observeGap(): void;
  arm(): boolean;
  settle(aborted: boolean | undefined): void;
  report(): OpenCodeFinalInterruptReport;
};
