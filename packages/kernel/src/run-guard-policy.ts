import {
  RUN_GUARD_DEFAULTS,
  RunWatchdogSettingsSchema,
  RunWatchdogSettingsUpdateSchema,
  WakeGuardSettingsSchema,
  WakeGuardSettingsUpdateSchema,
  type RunWatchdogSettings,
  type WakeGuardSettings,
} from "@rah-os/protocol";

/**
 * evo §37: the Kernel's single in-process owner of the wake-guard and
 * watchdog thresholds. Like placement capacity, these are operator settings,
 * not Room state: the daemon persists them with the concurrency caps (one
 * document, one revision, one Human API) and pushes every change here. Each
 * decision reads the current value, so a change applies to the next wake and
 * to running runs' next watchdog tick without a restart.
 */
export class RunGuardPolicy {
  #wakeGuard: WakeGuardSettings = { ...RUN_GUARD_DEFAULTS.wakeGuard };
  #watchdog: RunWatchdogSettings = { ...RUN_GUARD_DEFAULTS.watchdog };

  wakeGuard(): WakeGuardSettings {
    return { ...this.#wakeGuard };
  }

  watchdog(): RunWatchdogSettings {
    return { ...this.#watchdog };
  }

  /** Merges the given fields; validation precedes any change. */
  update(input: {
    wakeGuard?: Partial<WakeGuardSettings> | undefined;
    watchdog?: Partial<RunWatchdogSettings> | undefined;
  }): void {
    const wakeGuard = WakeGuardSettingsSchema.parse({
      ...this.#wakeGuard,
      ...WakeGuardSettingsUpdateSchema.parse(input.wakeGuard ?? {}),
    });
    const watchdog = RunWatchdogSettingsSchema.parse({
      ...this.#watchdog,
      ...RunWatchdogSettingsUpdateSchema.parse(input.watchdog ?? {}),
    });
    this.#wakeGuard = wakeGuard;
    this.#watchdog = watchdog;
  }
}
