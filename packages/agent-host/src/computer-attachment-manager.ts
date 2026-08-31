import type { RuntimeOffer } from "@rah-os/protocol";

import type { ComputerAttachment } from "./computer-attachment-store.ts";
import {
  ComputerResidentService,
  ComputerResidentServiceTerminalError,
  type ComputerControlClientPort,
  type ComputerResidentIdentity,
  type ComputerResidentServiceSnapshot,
  type ComputerResidentServiceTerminalReason,
} from "./computer-resident-service.ts";

export type ComputerAttachmentStorePort = {
  read(): Promise<ComputerAttachment[]>;
};

export type ComputerManagedAttachmentServicePort = Readonly<{
  reconcileOnce(): Promise<ComputerResidentServiceSnapshot>;
  snapshot(): ComputerResidentServiceSnapshot;
  stop(): Promise<unknown>;
}>;

export type ComputerAttachmentManagerOptions = {
  buildVersion: string;
  clientFactory(
    attachment: Readonly<ComputerAttachment>,
  ): ComputerControlClientPort;
  computerInstanceId?: string;
  managedServiceFactory?(input: {
    attachment: Readonly<ComputerAttachment>;
    resident: ComputerResidentService;
  }): ComputerManagedAttachmentServicePort;
  processId?: number;
  reconcileIntervalMs?: number;
  runtimeOffers(input: {
    attachment: Readonly<ComputerAttachment>;
    identity: Readonly<ComputerResidentIdentity>;
  }): Promise<readonly RuntimeOffer[]>;
  runtimeProtocolVersion: number;
  store: ComputerAttachmentStorePort;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
};

export type ComputerManagedAttachmentSnapshot =
  ComputerResidentServiceSnapshot & {
    terminalReason?: ComputerResidentServiceTerminalReason;
  };

export type ComputerAttachmentManagerSnapshot = {
  attachments: Record<string, ComputerManagedAttachmentSnapshot>;
  state: "idle" | "running" | "stopped";
};

type ManagedAttachment = {
  attachment: ComputerAttachment;
  service: ComputerManagedAttachmentServicePort;
  terminalReason?: ComputerResidentServiceTerminalReason;
  terminalSnapshot?: ComputerResidentServiceSnapshot;
};

/**
 * Reconciles the durable attachment catalog into independent control sessions.
 * A terminal fault parks only its own attachment; Room and Placement truth
 * remain entirely server-owned behind each control client.
 */
export class ComputerAttachmentManager {
  readonly #buildVersion: string;
  readonly #clientFactory: ComputerAttachmentManagerOptions["clientFactory"];
  readonly #computerInstanceId: string | undefined;
  readonly #managed = new Map<string, ManagedAttachment>();
  readonly #managedServiceFactory:
    ComputerAttachmentManagerOptions["managedServiceFactory"] | undefined;
  readonly #processId: number | undefined;
  readonly #reconcileIntervalMs: number;
  readonly #runtimeOffers: ComputerAttachmentManagerOptions["runtimeOffers"];
  readonly #runtimeProtocolVersion: number;
  readonly #store: ComputerAttachmentStorePort;
  readonly #wait: (delayMs: number, signal: AbortSignal) => Promise<void>;
  #reconcilePromise: Promise<ComputerAttachmentManagerSnapshot> | undefined;
  #running = false;
  #stopped = false;
  readonly #stopController = new AbortController();

  constructor(options: ComputerAttachmentManagerOptions) {
    this.#buildVersion = requiredString(options.buildVersion, "buildVersion");
    this.#clientFactory = options.clientFactory;
    this.#computerInstanceId = options.computerInstanceId;
    this.#managedServiceFactory = options.managedServiceFactory;
    this.#processId = options.processId;
    this.#reconcileIntervalMs = positiveInteger(
      options.reconcileIntervalMs ?? 5_000,
      "reconcileIntervalMs",
    );
    this.#runtimeOffers = options.runtimeOffers;
    this.#runtimeProtocolVersion = positiveInteger(
      options.runtimeProtocolVersion,
      "runtimeProtocolVersion",
    );
    this.#store = options.store;
    this.#wait = options.wait ?? waitForDelay;
  }

  snapshot(): ComputerAttachmentManagerSnapshot {
    const attachments: Record<string, ComputerManagedAttachmentSnapshot> = {};
    for (const [attachmentId, managed] of this.#managed) {
      attachments[attachmentId] = {
        ...(managed.terminalSnapshot ?? managed.service.snapshot()),
        ...(managed.terminalReason === undefined
          ? {}
          : { terminalReason: managed.terminalReason }),
      };
    }
    return {
      attachments,
      state: this.#stopped ? "stopped" : this.#running ? "running" : "idle",
    };
  }

  reconcileOnce(): Promise<ComputerAttachmentManagerSnapshot> {
    if (this.#stopped) return Promise.resolve(this.snapshot());
    if (this.#reconcilePromise !== undefined) return this.#reconcilePromise;
    const operation = this.#reconcile();
    this.#reconcilePromise = operation;
    const clear = () => {
      if (this.#reconcilePromise === operation)
        this.#reconcilePromise = undefined;
    };
    void operation.then(clear, clear);
    return operation;
  }

  async run(input: { signal: AbortSignal }): Promise<void> {
    if (this.#running)
      throw new Error("ComputerAttachmentManager is already running");
    if (this.#stopped)
      throw new Error("ComputerAttachmentManager has already stopped");
    this.#running = true;
    const signal = AbortSignal.any([input.signal, this.#stopController.signal]);
    try {
      while (!signal.aborted && !this.#stopped) {
        await this.reconcileOnce();
        if (signal.aborted || this.#stopped) break;
        await this.#wait(this.#reconcileIntervalMs, signal);
      }
    } finally {
      this.#running = false;
      if (input.signal.aborted && !this.#stopped) await this.stop();
    }
  }

  async stop(): Promise<ComputerAttachmentManagerSnapshot> {
    if (this.#stopped) return this.snapshot();
    this.#stopped = true;
    this.#stopController.abort("Computer attachment manager stopped");
    const inFlight = this.#reconcilePromise;
    if (inFlight !== undefined) {
      try {
        await inFlight;
      } catch {
        // Explicit shutdown still owns cleanup after a catalog read failure.
      }
    }
    const services = [...this.#managed.values()].map(({ service }) => service);
    this.#managed.clear();
    await Promise.allSettled(
      services.map(async (service) => await service.stop()),
    );
    return this.snapshot();
  }

  async #reconcile(): Promise<ComputerAttachmentManagerSnapshot> {
    const desired = await this.#store.read();
    const desiredById = new Map<string, ComputerAttachment>();
    for (const attachment of desired) {
      if (desiredById.has(attachment.attachmentId)) {
        throw new Error(`duplicate attachmentId: ${attachment.attachmentId}`);
      }
      desiredById.set(attachment.attachmentId, attachment);
    }

    const retired: ComputerManagedAttachmentServicePort[] = [];
    for (const [attachmentId, managed] of this.#managed) {
      const next = desiredById.get(attachmentId);
      if (next === undefined || !sameAttachment(managed.attachment, next)) {
        this.#managed.delete(attachmentId);
        retired.push(managed.service);
      }
    }
    await Promise.allSettled(
      retired.map(async (service) => await service.stop()),
    );

    for (const attachment of desired) {
      if (this.#managed.has(attachment.attachmentId)) continue;
      const stableAttachment = Object.freeze({ ...attachment });
      const resident = new ComputerResidentService({
        buildVersion: this.#buildVersion,
        client: this.#clientFactory(stableAttachment),
        ...(this.#computerInstanceId === undefined
          ? {}
          : { computerInstanceId: this.#computerInstanceId }),
        connectionId: stableAttachment.connectionId,
        ...(this.#processId === undefined
          ? {}
          : { processId: this.#processId }),
        runtimeOffers: async (identity) =>
          await this.#runtimeOffers({
            attachment: stableAttachment,
            identity,
          }),
        runtimeProtocolVersion: this.#runtimeProtocolVersion,
      });
      const service =
        this.#managedServiceFactory?.({
          attachment: stableAttachment,
          resident,
        }) ?? resident;
      this.#managed.set(stableAttachment.attachmentId, {
        attachment: stableAttachment,
        service,
      });
    }

    await Promise.all(
      [...this.#managed.values()].map(async (managed) => {
        if (managed.terminalReason !== undefined) return;
        try {
          await managed.service.reconcileOnce();
        } catch (error) {
          if (error instanceof ComputerResidentServiceTerminalError) {
            managed.terminalReason = error.reason;
            managed.terminalSnapshot = managed.service.snapshot();
            await managed.service.stop();
            return;
          }
          throw error;
        }
      }),
    );
    return this.snapshot();
  }
}

function sameAttachment(
  first: ComputerAttachment,
  second: ComputerAttachment,
): boolean {
  return (
    first.attachmentId === second.attachmentId &&
    first.connectionId === second.connectionId &&
    first.createdAt === second.createdAt &&
    first.hostAccessToken === second.hostAccessToken &&
    first.origin === second.origin
  );
}

function requiredString(value: string, name: string): string {
  const result = value.trim();
  if (result.length === 0) throw new Error(`${name} is required`);
  return result;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

async function waitForDelay(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });
  });
}
