import { realpath, stat } from "node:fs/promises";

/**
 * S2-b warm runtime policies (S2 spec §6; contract §6a). Every value is a
 * configurable initial operating value, not a performance guarantee or a
 * model-fault threshold. Driver-neutral: the S2-c drivers reuse them.
 *
 * - Idle eviction: `idleTtlMs` from the last turn end (lane released) or the
 *   last TUI detach; never while busy, draining, pending a lane release or
 *   pinned. An instance whose last measured cold resume took longer than
 *   `expensiveResumeMs` keeps `expensiveResumeTtlMultiplier` times the TTL
 *   (resuming it again is the expensive part); a per-instance hook may
 *   override the TTL outright.
 * - Boundary recycling, only at an idle runtime's next turn: process-group
 *   RSS above `recycleRssKb` (or admission closed by a busy RSS alert), age
 *   above `maxAgeMs`, or a changed CLI binary fingerprint. The launch-key
 *   restart (profile, Role snapshot, session generation) stays as before.
 * - Global cap: above `maxWarm` live runtimes the least recently used idle
 *   ones are evicted (soft: busy ones are never evicted); at most
 *   `maxBusyTurns` turns are admitted at once, a further one waits at most
 *   `admissionWaitMs`, then fails recoverably (its Activation is retried
 *   instead of holding its lease).
 * - Stall and duration: the evo §37 B run watchdog (`run-watchdog.ts`), with
 *   thresholds from the Human's runtime settings, not from this policy.
 * - Resource failure: at most `stallRetryBudget` recoverable retries per
 *   Activation, then sticky.
 * - Busy RSS above `recycleRssKb`: alert and close admission (no kill);
 *   above `emergencyRssKb`: explicit resource failure (proven kill).
 */
export type WarmRuntimePolicy = {
  idleTtlMs: number;
  expensiveResumeMs: number;
  expensiveResumeTtlMultiplier: number;
  recycleRssKb: number;
  maxAgeMs: number;
  maxWarm: number;
  maxBusyTurns: number;
  admissionWaitMs: number;
  stallRetryBudget: number;
  emergencyRssKb: number;
  /** How often a busy turn's progress clock is checked (real time). */
  supervisionIntervalMs: number;
  /** How often a busy turn's process-group RSS is measured (real time). */
  resourceCheckIntervalMs: number;
};

export const DEFAULT_WARM_RUNTIME_POLICY: Readonly<WarmRuntimePolicy> = {
  admissionWaitMs: 60_000,
  emergencyRssKb: 8 * 1024 * 1024,
  expensiveResumeMs: 20_000,
  expensiveResumeTtlMultiplier: 4,
  idleTtlMs: 30 * 60_000,
  maxAgeMs: 12 * 60 * 60_000,
  maxBusyTurns: 20,
  maxWarm: 12,
  recycleRssKb: 2 * 1024 * 1024,
  resourceCheckIntervalMs: 30_000,
  stallRetryBudget: 1,
  supervisionIntervalMs: 5_000,
};

export type WarmRuntimePolicyOverrides = {
  [Key in keyof WarmRuntimePolicy]?: WarmRuntimePolicy[Key] | undefined;
};

export function resolveWarmRuntimePolicy(
  overrides: WarmRuntimePolicyOverrides = {},
): WarmRuntimePolicy {
  const policy = { ...DEFAULT_WARM_RUNTIME_POLICY };
  for (const [key, value] of Object.entries(overrides) as [
    keyof WarmRuntimePolicy,
    number | undefined,
  ][]) {
    if (value === undefined) continue;
    const minimum = key === "stallRetryBudget" ? 0 : 1;
    if (!Number.isInteger(value) || value < minimum)
      throw new Error(
        `warm runtime policy ${key} must be an integer >= ${minimum}`,
      );
    policy[key] = value;
  }
  if (policy.emergencyRssKb < policy.recycleRssKb)
    throw new Error(
      "warm runtime policy emergencyRssKb must not be below recycleRssKb",
    );
  return policy;
}

/** The idle TTL of one instance (see the module note). */
export function warmIdleTtl(
  policy: WarmRuntimePolicy,
  lastColdResumeMs: number | undefined,
  override: number | undefined,
): number {
  if (override !== undefined && Number.isInteger(override) && override > 0)
    return override;
  return lastColdResumeMs !== undefined &&
    lastColdResumeMs > policy.expensiveResumeMs
    ? policy.idleTtlMs * policy.expensiveResumeTtlMultiplier
    : policy.idleTtlMs;
}

/**
 * CLI binary identity for boundary recycling: realpath + size + mtime. An
 * upgrade in place (same path) changes size or mtime; a re-pointed symlink
 * changes the realpath.
 */
export async function cliBinaryFingerprint(executable: string) {
  const resolved = await realpath(executable);
  const info = await stat(resolved);
  return `${resolved}:${String(info.size)}:${String(Math.trunc(info.mtimeMs))}`;
}
