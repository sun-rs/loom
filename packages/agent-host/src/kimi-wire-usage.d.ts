import type { ProviderUsage, ProviderUsageGap } from "./provider-usage.js";

export const KIMI_USAGE_PROVIDER: string;
export function kimiMainWirePath(
  sessionId: string,
  environment?: NodeJS.ProcessEnv,
): string | undefined;
export function kimiWireSize(path: string): number;
export type KimiWireIdentity = { dev: number; ino: number };
export function kimiWireBaseline(
  path: string,
): { offset: number; identity: KimiWireIdentity } | undefined;
export function kimiTurnUsage(
  text: string,
  options?: {
    now?: () => number;
    promptText?: string;
    promptSettled?: boolean;
  },
): { ended: boolean; usages: ProviderUsage[]; gaps: ProviderUsageGap[] };
export function readKimiTurnUsage(options: {
  path: string;
  offset: number;
  identity?: KimiWireIdentity;
  promptText?: string;
  promptSettled?: boolean;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
}): Promise<{ usages: ProviderUsage[]; gaps: ProviderUsageGap[] }>;
