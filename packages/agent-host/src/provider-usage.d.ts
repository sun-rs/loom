import type {
  ProviderCostFrame,
  ProviderUsageFrame,
  ProviderUsageGapFrame,
  ProviderUsageGapReason,
} from "@rah-os/protocol";

export type ProviderUsage = Omit<ProviderUsageFrame, "protocol">;
export type ProviderUsageGap = Omit<ProviderUsageGapFrame, "protocol">;
export type ProviderCost = Omit<ProviderCostFrame, "protocol">;

export class ClaudeResultCostTracker {
  constructor(options: { freshSession: boolean; now?: () => number });
  observe(frame: unknown): ProviderCost | undefined;
}

export function openCodeStepFinishCost(
  part: unknown,
  now?: () => number,
): ProviderCost | undefined;

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
  finish(): ProviderUsageGap | undefined;
  observe(frame: unknown): ProviderUsage | ProviderUsageGap | undefined;
}

export function openCodeStepFinishUsage(
  part: unknown,
  now?: () => number,
): ProviderUsage | ProviderUsageGap | undefined;

export class ProviderUsageWriter {
  constructor(write?: (value: string) => void);
  emit(
    usage: ProviderUsage | ProviderUsageGap | ProviderCost | undefined,
  ): void;
}
