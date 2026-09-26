import type { ProviderUsage, ProviderUsageGap } from "./provider-usage.js";

export const KIMI_USAGE_PROVIDER: string;
export function kimiMainWirePath(
  sessionId: string,
  environment?: NodeJS.ProcessEnv,
): string | undefined;
export function kimiWireSize(path: string): number;
export function kimiTurnUsage(
  text: string,
  options?: { now?: () => number },
): { ended: boolean; usages: ProviderUsage[]; gaps: ProviderUsageGap[] };
export function readKimiTurnUsage(options: {
  path: string;
  offset: number;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
}): Promise<{ usages: ProviderUsage[]; gaps: ProviderUsageGap[] }>;
