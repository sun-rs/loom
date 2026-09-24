export type CodexFinalInterruptReport = {
  /** The interrupt request was written. */
  requested: boolean;
  /** Answered: true; refused: false; timeout or lost answer: "unknown". */
  accepted: boolean | "unknown";
  /** The turn ended `interrupted`: true; another status: false. */
  terminal: boolean | "unknown";
  /** Requested and not refused (older readers). */
  sent: boolean;
  preemptedFollowUp: boolean | "unknown";
};
export function createCodexFinalInterrupt(options: {
  interrupt: () => Promise<unknown>;
}): {
  readonly armed: boolean;
  readonly issued: boolean;
  observe(frame: { method?: string; params?: Record<string, unknown> }): void;
  arm(): boolean;
  report(): Promise<CodexFinalInterruptReport>;
};
