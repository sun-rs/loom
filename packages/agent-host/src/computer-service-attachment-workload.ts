import type { ComputerAttachment } from "./computer-attachment-store.ts";
import {
  ComputerAttachmentManager,
  type ComputerAttachmentStorePort,
} from "./computer-attachment-manager.ts";
import type { ComputerControlClientPort } from "./computer-resident-service.ts";
import type { RemoteComputerAgentHostOptions } from "./remote-computer-agent-host-service.ts";
import { RemoteComputerManagedAttachmentService } from "./remote-computer-managed-attachment-service.ts";

const MAX_ATTACHMENTS = 128;

export type ComputerServiceAttachmentManagerPort = Readonly<{
  run(input: { signal: AbortSignal }): Promise<void>;
  stop(): Promise<unknown>;
}>;

export type ComputerServiceAttachmentWorkloadOptions = Readonly<{
  attachmentStore: Readonly<{
    read(): Promise<readonly ComputerAttachment[]>;
  }>;
  createManager(): ComputerServiceAttachmentManagerPort;
  parkedStore: Readonly<{
    read(): Promise<Readonly<Record<string, string>> | null>;
  }>;
}>;

export type RemoteComputerServiceAttachmentWorkloadOptions = Readonly<{
  agentHost(input: {
    attachment: Readonly<ComputerAttachment>;
    resident: import("./computer-resident-service.ts").ComputerResidentService;
  }): RemoteComputerAgentHostOptions;
  attachmentStore: ComputerAttachmentStorePort;
  buildVersion: string;
  capacity: number;
  clientFactory(
    attachment: Readonly<ComputerAttachment>,
  ): ComputerControlClientPort;
  computerInstanceId: string;
  parkedStore: ComputerServiceAttachmentWorkloadOptions["parkedStore"];
  processId?: number;
  reconcileIntervalMs?: number;
  runtimeOffers: import("./computer-attachment-manager.ts").ComputerAttachmentManagerOptions["runtimeOffers"];
  runtimeProtocolVersion: number;
  wait?: import("./computer-attachment-manager.ts").ComputerAttachmentManagerOptions["wait"];
}>;

/** The production multi-attachment Remote Computer workload composition. */
export function createRemoteComputerServiceAttachmentWorkload(
  options: RemoteComputerServiceAttachmentWorkloadOptions,
): ComputerServiceAttachmentWorkload {
  return new ComputerServiceAttachmentWorkload({
    attachmentStore: options.attachmentStore,
    createManager: () =>
      new ComputerAttachmentManager({
        buildVersion: options.buildVersion,
        clientFactory: options.clientFactory,
        computerInstanceId: options.computerInstanceId,
        managedServiceFactory: ({ attachment, resident }) =>
          new RemoteComputerManagedAttachmentService({
            agentHost: options.agentHost({ attachment, resident }),
            capacity: options.capacity,
            resident,
          }),
        ...(options.processId === undefined
          ? {}
          : { processId: options.processId }),
        ...(options.reconcileIntervalMs === undefined
          ? {}
          : { reconcileIntervalMs: options.reconcileIntervalMs }),
        runtimeOffers: options.runtimeOffers,
        runtimeProtocolVersion: options.runtimeProtocolVersion,
        store: options.attachmentStore,
        ...(options.wait === undefined ? {} : { wait: options.wait }),
      }),
    parkedStore: options.parkedStore,
  });
}

/**
 * Couples the durable attachment catalog to exactly one live attachment
 * manager while respecting K's durable parked snapshot. The manager remains
 * the sole catalog/session reconciler; this owner only starts, drains, and
 * recreates it around whole-service replacement.
 */
export class ComputerServiceAttachmentWorkload {
  readonly #attachmentStore: ComputerServiceAttachmentWorkloadOptions["attachmentStore"];
  readonly #createManager: ComputerServiceAttachmentWorkloadOptions["createManager"];
  readonly #parkedStore: ComputerServiceAttachmentWorkloadOptions["parkedStore"];
  readonly #completion: Promise<void>;
  #complete!: () => void;
  #failure: unknown;
  #held = false;
  #manager: ComputerServiceAttachmentManagerPort | undefined;
  #managerController: AbortController | undefined;
  #managerRun: Promise<void> | undefined;
  #operationTail: Promise<void> = Promise.resolve();
  readonly #readiness: Promise<void>;
  #readinessSettled = false;
  #rejectReadiness!: (reason: unknown) => void;
  #resolveReadiness!: () => void;
  #runSignal: AbortSignal | undefined;
  #running = false;
  #stopped = false;

  constructor(options: ComputerServiceAttachmentWorkloadOptions) {
    this.#attachmentStore = options.attachmentStore;
    this.#createManager = options.createManager;
    this.#parkedStore = options.parkedStore;
    this.#completion = new Promise<void>((resolve) => {
      this.#complete = resolve;
    });
    this.#readiness = new Promise<void>((resolve, reject) => {
      this.#resolveReadiness = resolve;
      this.#rejectReadiness = reject;
    });
    void this.#readiness.catch(() => undefined);
  }

  async managedAttachmentIdentities(): Promise<
    Readonly<Record<string, string>>
  > {
    return await this.#readCatalogIdentities();
  }

  async ready(): Promise<void> {
    await this.#readiness;
  }

  async holdManagedAttachments(
    expected: Readonly<Record<string, string>>,
  ): Promise<void> {
    const normalizedExpected = attachmentIdentities(expected);
    await this.#serialize(async () => {
      this.#requireRunning();
      const current = await this.#readCatalogIdentities();
      if (!sameAttachmentIdentities(current, normalizedExpected)) {
        throw new Error("managed attachment set changed before hold");
      }
      this.#held = true;
      await this.#stopManager();
    });
  }

  async releaseManagedAttachmentsHold(): Promise<void> {
    await this.#serialize(async () => {
      this.#requireRunning();
      if (!this.#held) return;
      this.#held = false;
      if (!this.#runSignal!.aborted) this.#startManager();
    });
  }

  async run(input: { signal: AbortSignal }): Promise<void> {
    if (this.#running || this.#stopped) {
      throw new Error("Computer service attachment workload can only run once");
    }
    this.#running = true;
    this.#runSignal = input.signal;
    const onAbort = () => this.#complete();
    input.signal.addEventListener("abort", onAbort, { once: true });
    try {
      await this.#serialize(async () => {
        const [parked, current] = await Promise.all([
          this.#parkedStore.read(),
          this.#readCatalogIdentities(),
        ]);
        if (parked !== null) {
          const normalizedParked = attachmentIdentities(parked);
          if (!sameAttachmentIdentities(normalizedParked, current)) {
            throw new Error(
              "parked managed attachment set does not match the catalog",
            );
          }
          this.#held = true;
        }
        if (!input.signal.aborted && !this.#held) this.#startManager();
      });
      this.#settleReadiness();
      if (input.signal.aborted) this.#complete();
      await this.#completion;
      await this.#serialize(async () => await this.#stopManager());
      if (this.#failure !== undefined) throw this.#failure;
    } catch (error) {
      this.#settleReadiness(error);
      throw error;
    } finally {
      this.#settleReadiness(
        new Error("Computer service attachment workload stopped before ready"),
      );
      input.signal.removeEventListener("abort", onAbort);
      await this.#serialize(async () => await this.#stopManager()).catch(
        () => undefined,
      );
      this.#running = false;
      this.#stopped = true;
    }
  }

  #requireRunning(): void {
    if (!this.#running || this.#stopped || this.#runSignal === undefined) {
      throw new Error("Computer service attachment workload is not running");
    }
  }

  #settleReadiness(error?: unknown): void {
    if (this.#readinessSettled) return;
    this.#readinessSettled = true;
    if (error === undefined) this.#resolveReadiness();
    else this.#rejectReadiness(error);
  }

  #startManager(): void {
    if (this.#manager !== undefined) return;
    const manager = this.#createManager();
    const controller = new AbortController();
    const run = Promise.resolve().then(
      async () => await manager.run({ signal: controller.signal }),
    );
    this.#manager = manager;
    this.#managerController = controller;
    this.#managerRun = run;
    void run.then(
      () => this.#recordManagerExit(manager, controller),
      (error: unknown) => this.#recordManagerExit(manager, controller, error),
    );
  }

  #recordManagerExit(
    manager: ComputerServiceAttachmentManagerPort,
    controller: AbortController,
    error?: unknown,
  ): void {
    void this.#serialize(async () => {
      if (this.#manager !== manager || controller.signal.aborted) return;
      this.#failure =
        error ?? new Error("attachment manager stopped unexpectedly");
      this.#complete();
    });
  }

  async #stopManager(): Promise<void> {
    const manager = this.#manager;
    const controller = this.#managerController;
    const run = this.#managerRun;
    if (
      manager === undefined ||
      controller === undefined ||
      run === undefined
    ) {
      return;
    }
    this.#manager = undefined;
    this.#managerController = undefined;
    this.#managerRun = undefined;
    controller.abort("Computer attachment manager drained");
    const outcomes = await Promise.allSettled([manager.stop(), run]);
    const failures = outcomes.flatMap((outcome) =>
      outcome.status === "rejected" ? [outcome.reason] : [],
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        "Computer attachment manager drain failed",
      );
    }
  }

  async #readCatalogIdentities(): Promise<Readonly<Record<string, string>>> {
    const attachments = await this.#attachmentStore.read();
    if (attachments.length > MAX_ATTACHMENTS) {
      throw new Error("managed attachment catalog exceeds 128 entries");
    }
    const identities: Record<string, string> = {};
    for (const attachment of attachments) {
      const attachmentId = identifier(
        attachment.attachmentId,
        "attachmentId",
        256,
      );
      if (Object.hasOwn(identities, attachmentId)) {
        throw new Error(`duplicate attachmentId: ${attachmentId}`);
      }
      identities[attachmentId] = identifier(
        attachment.connectionId,
        `managedAttachmentIdentities.${attachmentId}`,
        512,
      );
    }
    return attachmentIdentities(identities);
  }

  #serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.#operationTail.then(operation, operation);
    this.#operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function attachmentIdentities(
  value: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("managed attachment identities must be an object");
  }
  const keys = Object.keys(value).sort();
  if (keys.length > MAX_ATTACHMENTS) {
    throw new Error("managed attachment identities exceed 128 entries");
  }
  const output: Record<string, string> = {};
  const connections = new Set<string>();
  for (const key of keys) {
    const attachmentId = identifier(key, "attachmentId", 256);
    const connectionId = identifier(
      value[key],
      `managedAttachmentIdentities.${attachmentId}`,
      512,
    );
    if (connections.has(connectionId)) {
      throw new Error(
        "managed attachment connection identities must be unique",
      );
    }
    connections.add(connectionId);
    output[attachmentId] = connectionId;
  }
  return Object.freeze(output);
}

function sameAttachmentIdentities(
  first: Readonly<Record<string, string>>,
  second: Readonly<Record<string, string>>,
): boolean {
  const firstKeys = Object.keys(first);
  const secondKeys = Object.keys(second);
  return (
    firstKeys.length === secondKeys.length &&
    firstKeys.every(
      (key, index) => key === secondKeys[index] && first[key] === second[key],
    )
  );
}

function identifier(value: unknown, name: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}
