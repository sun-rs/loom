import { join } from "node:path";

import {
  resolveAgentStartSchedulerSettings,
  type InstanceRuntimePool,
} from "@rah-os/agent-host";
import type { PlacementCapacityPolicy, RoomKernel } from "@rah-os/kernel";
import type { RuntimeSettings as RuntimeSettingsView } from "@rah-os/protocol";

import type { DaemonConfig } from "./config.ts";
import { RuntimeSettings } from "./runtime-settings.ts";

/** The Human's runtime settings document in the daemon state directory. */
export const RUNTIME_SETTINGS_FILE = "runtime-settings.json";
/** Its name before the rename; migrated once at startup (see RuntimeSettings). */
export const LEGACY_RUNTIME_SETTINGS_FILE = "runtime-concurrency.json";

type ConcurrencyLanes = {
  setCapacity(capacity: number): void;
  updateStartScheduler(settings: {
    maxConcurrentStarts?: number;
    minStartIntervalMs?: number;
  }): void;
};

/**
 * Composes the Human's runtime settings with their appliers: the Kernel
 * placement caps (Host cap and one cap per CLI RuntimeProfile), the Kernel
 * run guards (evo §37 wake chain limit and watchdog thresholds), the Host
 * lanes, the warm pool's busy-turn cap and the start gate. Only v4 (multi-lane)
 * daemons have them; v2/v3 keep their fixed single lane.
 */
export function openDaemonRuntimeSettings(
  config: DaemonConfig,
): DaemonRuntimeSettings | undefined {
  if (config.schemaVersion !== 4) return undefined;
  const startDefaults = resolveAgentStartSchedulerSettings(undefined);
  const settings = new RuntimeSettings({
    defaults: {
      maxConcurrentRuns: config.host.maxConcurrent,
      maxConcurrentStarts: startDefaults.maxConcurrentStarts,
      minStartIntervalMs: startDefaults.minStartIntervalMs,
    },
    legacyPath: join(config.stateDirectory, LEGACY_RUNTIME_SETTINGS_FILE),
    path: join(config.stateDirectory, RUNTIME_SETTINGS_FILE),
    runtimes: config.runtimes.map((runtime) => ({
      offerMaxConcurrent: runtime.offer.maxConcurrent,
      runtimeOfferId: runtime.offer.runtimeOfferId,
      runtimeProfileId: runtime.runtimeProfileId,
    })),
  });
  return new DaemonRuntimeSettings(config.host.hostId, settings);
}

export class DaemonRuntimeSettings {
  readonly settings: RuntimeSettings;
  readonly #hostId: string;

  constructor(hostId: string, settings: RuntimeSettings) {
    this.#hostId = hostId;
    this.settings = settings;
  }

  placementCapacityPolicy(): PlacementCapacityPolicy {
    const view = this.settings.read();
    return {
      defaultMaxConcurrent: view.maxConcurrentRuns,
      ...this.#limits(view),
    };
  }

  startScheduler() {
    const view = this.settings.read();
    return {
      maxConcurrentStarts: view.maxConcurrentStarts,
      minStartIntervalMs: view.minStartIntervalMs,
    };
  }

  /** Applies the current values now and every later update immediately. */
  attach(input: {
    kernel: RoomKernel;
    lanes: ConcurrencyLanes | undefined;
    pool: InstanceRuntimePool | undefined;
  }): void {
    const apply = (view: RuntimeSettingsView) => {
      input.kernel.placementCapacity.update(this.#limits(view));
      input.kernel.runGuards.update({
        wakeGuard: view.wakeGuard,
        watchdog: view.watchdog,
      });
      input.lanes?.setCapacity(view.maxConcurrentRuns);
      input.lanes?.updateStartScheduler({
        maxConcurrentStarts: view.maxConcurrentStarts,
        minStartIntervalMs: view.minStartIntervalMs,
      });
      // Raises only: a reduction is enforced by the Kernel placement caps
      // above, so work already placed under the old cap starts and drains.
      input.pool?.setMaxBusyTurns(view.maxConcurrentRuns);
    };
    apply(this.settings.read());
    this.settings.onChange(apply);
  }

  #limits(view: RuntimeSettingsView) {
    return {
      hostLimits: [
        { hostId: this.#hostId, maxConcurrent: view.maxConcurrentRuns },
      ],
      runtimeProfileLimits: view.runtimes.map((runtime) => ({
        hostId: this.#hostId,
        maxConcurrent: runtime.maxConcurrentRuns,
        runtimeProfileId: runtime.runtimeProfileId,
      })),
    };
  }
}
