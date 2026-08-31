import type { Slot } from "@rah-os/k-carrier";

import { readComputerServiceLiveAttestation } from "./computer-service-ownership-proof.ts";
import { requestComputerServiceUpgradeControl } from "./computer-service-upgrade-control.ts";
import type {
  KCarrierComputerServiceHostPort,
  LiveComputerServiceAttestation,
} from "./k-carrier-computer-host-adapter.ts";
import type { ComputerServiceSupervisorControlPort } from "./computer-service-supervisor.ts";

export type NodeKCarrierComputerServiceHostOptions = Readonly<{
  launchSlotService?(slot: Slot): Promise<void>;
  nowMs?: () => number;
  ownershipControlToken: string;
  ownershipSocketPath: string;
  requestTimeoutMs?: number;
  stopPollIntervalMs?: number;
  stopTimeoutMs?: number;
  supervisor?: ComputerServiceSupervisorControlPort;
  upgradeControlSocketPath: string;
  upgradeControlToken: string;
  wait?: (delayMs: number) => Promise<void>;
}>;

/**
 * Node process-boundary implementation of the K service port. Read evidence
 * comes from the singleton socket; mutations use a separate authenticated,
 * PID-and-generation-fenced control socket. Slot launch remains a narrow
 * packaging seam because installers decide how an artifact is executed.
 */
export class NodeKCarrierComputerServiceHost implements KCarrierComputerServiceHostPort {
  readonly #launchSlotService:
    | NonNullable<NodeKCarrierComputerServiceHostOptions["launchSlotService"]>
    | undefined;
  readonly #nowMs: () => number;
  readonly #ownershipControlToken: string;
  readonly #ownershipSocketPath: string;
  readonly #requestTimeoutMs: number;
  readonly #stopPollIntervalMs: number;
  readonly #stopTimeoutMs: number;
  readonly #supervisor: ComputerServiceSupervisorControlPort | undefined;
  readonly #upgradeControlSocketPath: string;
  readonly #upgradeControlToken: string;
  readonly #wait: (delayMs: number) => Promise<void>;

  constructor(options: NodeKCarrierComputerServiceHostOptions) {
    if (
      (options.launchSlotService === undefined) ===
      (options.supervisor === undefined)
    ) {
      throw new Error(
        "Computer service host requires exactly one lifecycle owner",
      );
    }
    this.#launchSlotService = options.launchSlotService;
    this.#nowMs = options.nowMs ?? Date.now;
    this.#ownershipControlToken = options.ownershipControlToken;
    this.#ownershipSocketPath = options.ownershipSocketPath;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs ?? 2_000,
      "requestTimeoutMs",
    );
    this.#stopPollIntervalMs = positiveInteger(
      options.stopPollIntervalMs ?? 50,
      "stopPollIntervalMs",
    );
    this.#stopTimeoutMs = positiveInteger(
      options.stopTimeoutMs ?? 10_000,
      "stopTimeoutMs",
    );
    this.#supervisor = options.supervisor;
    this.#upgradeControlSocketPath = options.upgradeControlSocketPath;
    this.#upgradeControlToken = options.upgradeControlToken;
    this.#wait = options.wait ?? wait;
  }

  async readLiveServiceAttestation(): Promise<LiveComputerServiceAttestation | null> {
    const live = await readComputerServiceLiveAttestation({
      controlToken: this.#ownershipControlToken,
      socketPath: this.#ownershipSocketPath,
      timeoutMs: this.#requestTimeoutMs,
    });
    if (live === null) return null;
    return Object.freeze({
      buildVersion: live.buildVersion,
      managedAttachmentIdentities: Object.freeze({
        ...live.managedAttachmentIdentities,
      }),
      processId: live.candidateProcessId,
      serviceGeneration: live.serviceGeneration,
    });
  }

  async holdManagedAttachments(
    expected: Readonly<Record<string, string>>,
  ): Promise<void> {
    const live = await this.#requireLive();
    await requestComputerServiceUpgradeControl({
      controlToken: this.#upgradeControlToken,
      expectedManagedAttachmentIdentities: expected,
      expectedProcessId: live.processId,
      expectedServiceGeneration: live.serviceGeneration,
      operation: "hold",
      socketPath: this.#upgradeControlSocketPath,
      timeoutMs: this.#requestTimeoutMs,
    });
  }

  async releaseManagedAttachmentsHold(): Promise<void> {
    const live = await this.#requireLive();
    await requestComputerServiceUpgradeControl({
      controlToken: this.#upgradeControlToken,
      expectedProcessId: live.processId,
      expectedServiceGeneration: live.serviceGeneration,
      operation: "release",
      socketPath: this.#upgradeControlSocketPath,
      timeoutMs: this.#requestTimeoutMs,
    });
  }

  async stopService(_slot: Slot): Promise<void> {
    const live = await this.readLiveServiceAttestation();
    if (live === null) return;
    if (this.#supervisor === undefined) {
      await requestComputerServiceUpgradeControl({
        controlToken: this.#upgradeControlToken,
        expectedProcessId: live.processId,
        expectedServiceGeneration: live.serviceGeneration,
        operation: "stop",
        socketPath: this.#upgradeControlSocketPath,
        timeoutMs: this.#requestTimeoutMs,
      });
    } else {
      await this.#supervisor.stopForHandoff({
        expectedProcessId: live.processId,
      });
    }
    const deadline = this.#time() + this.#stopTimeoutMs;
    while (true) {
      const observed = await this.readLiveServiceAttestation();
      if (
        observed === null ||
        observed.processId !== live.processId ||
        observed.serviceGeneration !== live.serviceGeneration
      ) {
        return;
      }
      const remaining = deadline - this.#time();
      if (remaining <= 0) {
        throw new Error(
          "stopped Computer service retained singleton ownership",
        );
      }
      await this.#wait(Math.min(this.#stopPollIntervalMs, remaining));
    }
  }

  async startService(slot: Slot): Promise<void> {
    if (this.#supervisor === undefined) {
      await this.#launchSlotService!(slot);
    } else {
      await this.#supervisor.startForHandoff(slot);
    }
  }

  async #requireLive(): Promise<LiveComputerServiceAttestation> {
    const live = await this.readLiveServiceAttestation();
    if (live === null) {
      throw new Error("live Computer service is unavailable");
    }
    return live;
  }

  #time(): number {
    const value = this.#nowMs();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(
        "Computer service host clock must return epoch milliseconds",
      );
    }
    return value;
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

async function wait(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
