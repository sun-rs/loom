import { join } from "node:path";

import {
  resolveAgentStartSchedulerSettings,
  type InstanceRuntimePool,
} from "@rah-os/agent-host";
import type { PlacementCapacityPolicy, RoomKernel } from "@rah-os/kernel";
import type { RuntimeConcurrencySettings as RuntimeConcurrencyView } from "@rah-os/protocol";

import type { DaemonConfig } from "./config.ts";
import { RuntimeConcurrencySettings } from "./runtime-concurrency-settings.ts";

type ConcurrencyLanes = {
  setCapacity(capacity: number): void;
  updateStartScheduler(settings: {
    maxConcurrentStarts?: number;
    minStartIntervalMs?: number;
  }): void;
};

/**
 * Composes the Human's concurrency settings with their appliers: the Kernel
 * placement caps (Host cap and one cap per CLI RuntimeProfile), the Kernel
 * run guards (evo §37 wake chain limit and watchdog thresholds), the Host
 * lanes, the warm pool's busy-turn cap and the start gate. Only v4 (multi-lane)
 * daemons have them; v2/v3 keep their fixed single lane.
 */
export function openDaemonRuntimeConcurrency(
  config: DaemonConfig,
): DaemonRuntimeConcurrency | undefined {
  if (config.schemaVersion !== 4) return undefined;
  const startDefaults = resolveAgentStartSchedulerSettings(undefined);
  const settings = new RuntimeConcurrencySettings({
    defaults: {
      maxConcurrentRuns: config.host.maxConcurrent,
      maxConcurrentStarts: startDefaults.maxConcurrentStarts,
      minStartIntervalMs: startDefaults.minStartIntervalMs,
    },
    path: join(config.stateDirectory, "runtime-concurrency.json"),
    runtimes: config.runtimes.map((runtime) => ({
      offerMaxConcurrent: runtime.offer.maxConcurrent,
      runtimeOfferId: runtime.offer.runtimeOfferId,
      runtimeProfileId: runtime.runtimeProfileId,
    })),
  });
  return new DaemonRuntimeConcurrency(config.host.hostId, settings);
}

export class DaemonRuntimeConcurrency {
  readonly settings: RuntimeConcurrencySettings;
  readonly #hostId: string;

  constructor(hostId: string, settings: RuntimeConcurrencySettings) {
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
    const apply = (view: RuntimeConcurrencyView) => {
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
      input.pool?.setMaxBusyTurns(view.maxConcurrentRuns);
    };
    apply(this.settings.read());
    this.settings.onChange(apply);
  }

  #limits(view: RuntimeConcurrencyView) {
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
