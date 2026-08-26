import { buildRuntimeOfferFromProfile } from "@rah-os/agent-host";
import {
  UnauthenticatedError,
  type AuthenticatedHostContext,
  type RoomKernel,
} from "@rah-os/core";
import type {
  RuntimeProfileProbeReport,
  RuntimeProfileRevision,
  WorkspaceMountDescriptor,
} from "@rah-os/protocol";

export class RuntimeOfferPublisher {
  readonly #host: AuthenticatedHostContext;
  readonly #kernel: RoomKernel;
  readonly #leaseMs: number;
  readonly #maxConcurrent: number;
  #probeReport: RuntimeProfileProbeReport;
  readonly #refreshProbe: () => Promise<RuntimeProfileProbeReport>;
  readonly #revisionIsActive: () => boolean;
  readonly #refreshIntervalMs: number;
  readonly #runtimeOfferId: string;
  readonly #runtimeExecutableIdentity:
    RuntimeProfileProbeReport["executableIdentity"] | undefined;
  readonly #runtimeProfileRevision: RuntimeProfileRevision;
  readonly #workspaceMountDescriptors: WorkspaceMountDescriptor[];
  #lastObservedAtMs = 0;

  constructor(input: {
    host: AuthenticatedHostContext;
    kernel: RoomKernel;
    leaseMs: number;
    maxConcurrent: number;
    probeReport: RuntimeProfileProbeReport;
    refreshIntervalMs: number;
    refreshProbe: () => Promise<RuntimeProfileProbeReport>;
    revisionIsActive: () => boolean;
    runtimeOfferId: string;
    runtimeProfileRevision: RuntimeProfileRevision;
    workspaceMountDescriptors?: WorkspaceMountDescriptor[];
  }) {
    this.#host = input.host;
    this.#kernel = input.kernel;
    this.#leaseMs = input.leaseMs;
    this.#maxConcurrent = input.maxConcurrent;
    this.#probeReport = structuredClone(input.probeReport);
    this.#refreshIntervalMs = input.refreshIntervalMs;
    this.#refreshProbe = input.refreshProbe;
    this.#revisionIsActive = input.revisionIsActive;
    this.#runtimeOfferId = input.runtimeOfferId;
    this.#runtimeExecutableIdentity = structuredClone(
      input.probeReport.executableIdentity,
    );
    this.#runtimeProfileRevision = structuredClone(
      input.runtimeProfileRevision,
    );
    this.#workspaceMountDescriptors = structuredClone(
      input.workspaceMountDescriptors ?? [],
    );
  }

  async run(signal: AbortSignal): Promise<void> {
    try {
      while (!signal.aborted) {
        await waitForAbortOrDelay(this.#refreshIntervalMs, signal);
        if (signal.aborted) break;
        this.#probeReport = await this.#refreshProbe();
        this.#tryPublish(this.#currentOfferState());
      }
    } finally {
      this.publishUnavailable();
    }
  }

  publishAvailable(): boolean {
    return this.#tryPublish(this.#currentOfferState());
  }

  publishUnavailable(): boolean {
    return this.#tryPublish("unavailable");
  }

  #currentOfferState(): "available" | "unavailable" {
    const current = this.#probeReport.executableIdentity;
    const expected = this.#runtimeExecutableIdentity;
    return this.#revisionIsActive() &&
      this.#probeReport.available &&
      current !== undefined &&
      expected !== undefined &&
      current.requestedExecutable === expected.requestedExecutable &&
      current.resolvedExecutablePath === expected.resolvedExecutablePath &&
      current.contentDigest === expected.contentDigest &&
      current.byteLength === expected.byteLength
      ? "available"
      : "unavailable";
  }

  #tryPublish(state: "available" | "unavailable"): boolean {
    try {
      this.#publish(state);
      return true;
    } catch (error) {
      if (
        error instanceof UnauthenticatedError &&
        error.message === "Host daemon instance is not active"
      ) {
        return false;
      }
      throw error;
    }
  }

  #publish(state: "available" | "unavailable"): void {
    const observedAtMs = Math.max(Date.now(), this.#lastObservedAtMs + 1);
    this.#lastObservedAtMs = observedAtMs;
    this.#kernel.publishRuntimeOffer(
      this.#host,
      buildRuntimeOfferFromProfile({
        hostId: this.#host.hostId,
        hostInstanceId: this.#host.instanceId,
        leaseUntil: new Date(observedAtMs + this.#leaseMs).toISOString(),
        maxConcurrent: this.#maxConcurrent,
        observedAt: new Date(observedAtMs).toISOString(),
        probeReport: this.#probeReport,
        runtimeOfferId: this.#runtimeOfferId,
        runtimeProfileRevision: this.#runtimeProfileRevision,
        state,
        workspaceMountDescriptors: this.#workspaceMountDescriptors,
      }),
    );
  }
}

async function waitForAbortOrDelay(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolvePromise) => {
    const timer = setTimeout(finish, delayMs);
    const onAbort = () => finish();
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolvePromise();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
