export type CodexFinalInterruptReport = {
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
