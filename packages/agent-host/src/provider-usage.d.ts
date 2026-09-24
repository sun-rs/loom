import type { ProviderUsageFrame } from "@rah-os/protocol";

export type ProviderUsage = Omit<ProviderUsageFrame, "protocol">;

export class CodexTokenUsageTracker {
  constructor(options: { freshThread: boolean; now?: () => number });
  observe(frame: unknown): ProviderUsage | undefined;
}

export class ClaudeStreamUsageTracker {
  constructor(options?: { now?: () => number });
  observe(frame: unknown): ProviderUsage | undefined;
}

export function openCodeStepFinishUsage(
  part: unknown,
  now?: () => number,
): ProviderUsage | undefined;

export class ProviderUsageWriter {
  constructor(write?: (value: string) => void);
  emit(usage: ProviderUsage | undefined): void;
}
