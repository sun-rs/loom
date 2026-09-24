import type {
  ProviderUsageFrame,
  ProviderUsageGapFrame,
  ProviderUsageGapReason,
} from "@rah-os/protocol";

export type ProviderUsage = Omit<ProviderUsageFrame, "protocol">;
export type ProviderUsageGap = Omit<ProviderUsageGapFrame, "protocol">;

export function providerUsageGap(
  provider: string,
  reason: ProviderUsageGapReason,
  now?: () => number,
): ProviderUsageGap;

export class CodexTokenUsageTracker {
  constructor(options: { freshThread: boolean; now?: () => number });
  observe(frame: unknown): ProviderUsage | ProviderUsageGap | undefined;
}

export class ClaudeStreamUsageTracker {
  constructor(options?: { now?: () => number });
  observe(frame: unknown): ProviderUsage | ProviderUsageGap | undefined;
}

export function openCodeStepFinishUsage(
  part: unknown,
  now?: () => number,
): ProviderUsage | ProviderUsageGap | undefined;

export class ProviderUsageWriter {
  constructor(write?: (value: string) => void);
  emit(usage: ProviderUsage | ProviderUsageGap | undefined): void;
}
