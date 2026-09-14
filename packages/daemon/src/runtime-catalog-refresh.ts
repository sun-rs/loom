import type {
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
} from "@rah-os/agent-host";
import type {
  RuntimeProfileRevision,
  RuntimeProfileProbeReport,
} from "@rah-os/protocol";
import { assertRuntimeProfileRevisionStillActive } from "./runtime-profile-composition.ts";
import {
  configuredRuntimeSnapshotWithValidation,
  type ConfiguredLocalRuntimeSnapshot,
} from "./local-runtime-inventory.ts";
import type { RuntimeOfferPublisher } from "./runtime-offer-publisher.ts";

/** Explicit Human refresh only; periodic offer renewal never invokes model discovery. */
export class RuntimeCatalogRefresh {
  readonly #refreshers = new Map<string, () => Promise<void>>();
  readonly #pending = new Map<string, Promise<void>>();

  register(input: {
    runtimeOfferId: string;
    revision: RuntimeProfileRevision;
    initialReport: RuntimeProfileProbeReport;
    registry: RuntimeProfileRegistry;
    implementations: RuntimeImplementationRegistry;
    publisher: RuntimeOfferPublisher;
    configured: ConfiguredLocalRuntimeSnapshot[];
    cwd: string;
  }): void {
    input.configured.push(
      configuredRuntimeSnapshotWithValidation({
        probeReport: input.initialReport,
        registry: input.registry,
        runtimeOfferId: input.runtimeOfferId,
        runtimeProfileRevision: input.revision,
      }),
    );
    this.#refreshers.set(input.runtimeOfferId, async () => {
      assertRuntimeProfileRevisionStillActive(input.registry, input.revision);
      const observed = await input.implementations.probeRevision(
        input.revision,
        { cwd: input.cwd },
      );
      assertRuntimeProfileRevisionStillActive(input.registry, input.revision);
      if (!observed.available)
        throw new Error(
          `Model refresh failed: ${observed.failureCode ?? "unavailable"}`,
        );
      const index = input.configured.findIndex(
        (row) => row.runtimeOfferId === input.runtimeOfferId,
      );
      if (index < 0) throw new Error("Runtime is no longer configured");
      const report = input.registry.recordProbeReport(observed);
      const snapshot = configuredRuntimeSnapshotWithValidation({
        probeReport: report,
        registry: input.registry,
        runtimeOfferId: input.runtimeOfferId,
        runtimeProfileRevision: input.revision,
      });
      input.publisher.replaceProbeReport(report);
      input.configured[index] = snapshot;
    });
  }

  async refresh(offerId: string): Promise<void> {
    const refresh = this.#refreshers.get(offerId);
    if (!refresh)
      throw new Error("This Runtime does not support model refresh");
    let pending = this.#pending.get(offerId);
    if (!pending) {
      pending = refresh().finally(() => this.#pending.delete(offerId));
      this.#pending.set(offerId, pending);
    }
    await pending;
  }
}

export function activeRuntimeRevision(
  registry: RuntimeProfileRegistry,
  revision: RuntimeProfileRevision,
): () => boolean {
  return () => {
    try {
      assertRuntimeProfileRevisionStillActive(registry, revision);
      return true;
    } catch {
      return false;
    }
  };
}
