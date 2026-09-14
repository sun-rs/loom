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
  #available: boolean;
  readonly #refreshAvailability: () => Promise<boolean>;
  readonly #revisionIsActive: () => boolean;
  readonly #refreshIntervalMs: number;
  readonly #runtimeOfferId: string;
  readonly #runtimeExecutableIdentity:
    RuntimeProfileProbeReport["executableIdentity"] | undefined;
  readonly #runtimeProfileRevision: RuntimeProfileRevision;
  #workspaceMountDescriptors: WorkspaceMountDescriptor[];
  readonly #refreshWorkspaceMountDescriptors:
    (() => Promise<WorkspaceMountDescriptor[]>) | undefined;
  #lastObservedAtMs = 0;

  constructor(input: {
    host: AuthenticatedHostContext;
    kernel: RoomKernel;
    leaseMs: number;
    maxConcurrent: number;
    probeReport: RuntimeProfileProbeReport;
    refreshAvailability: () => Promise<boolean>;
    refreshIntervalMs: number;
    revisionIsActive: () => boolean;
    runtimeOfferId: string;
    runtimeProfileRevision: RuntimeProfileRevision;
    workspaceMountDescriptors?: WorkspaceMountDescriptor[];
    refreshWorkspaceMountDescriptors?: () => Promise<
      WorkspaceMountDescriptor[]
    >;
  }) {
    this.#refreshWorkspaceMountDescriptors =
      input.refreshWorkspaceMountDescriptors;
    this.#host = input.host;
    this.#kernel = input.kernel;
    this.#leaseMs = input.leaseMs;
    this.#maxConcurrent = input.maxConcurrent;
    this.#probeReport = structuredClone(input.probeReport);
    this.#available = input.probeReport.available;
    this.#refreshIntervalMs = input.refreshIntervalMs;
    this.#refreshAvailability = input.refreshAvailability;
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
        await this.refreshWorkspaceMounts();
        this.#available = await this.#refreshAvailability();
        this.#tryPublish(this.#currentOfferState());
      }
    } finally {
      this.publishUnavailable();
    }
  }

  async refreshWorkspaceMounts(): Promise<void> {
    if (this.#refreshWorkspaceMountDescriptors)
      this.#workspaceMountDescriptors =
        await this.#refreshWorkspaceMountDescriptors();
  }

  replaceProbeReport(report: RuntimeProfileProbeReport): void {
    const identity = report.executableIdentity,
      expected = this.#runtimeExecutableIdentity;
    if (
      !this.#revisionIsActive() ||
      !report.available ||
      !identity ||
      !expected ||
      identity.contentDigest !== expected.contentDigest ||
      identity.resolvedExecutablePath !== expected.resolvedExecutablePath ||
      identity.requestedExecutable !== expected.requestedExecutable ||
      identity.byteLength !== expected.byteLength
    ) {
      throw new Error(
        "Runtime executable identity changed or unavailable; restart required",
      );
    }
    const previous = this.#probeReport;
    this.#probeReport = structuredClone(report);
    try {
      if (!this.publishAvailable())
        throw new Error("Runtime host is no longer active");
    } catch (error) {
      this.#probeReport = previous;
      throw error;
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
      this.#available &&
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
        ...(this.#refreshWorkspaceMountDescriptors
          ? { supportsAgentPrivateWorkspace: true }
          : {}),
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
