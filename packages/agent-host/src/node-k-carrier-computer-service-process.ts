import { randomUUID } from "node:crypto";

import { UnixSocketInstanceLock } from "./agent-host-daemon.ts";
import { createComputerServiceOwnershipProofHandler } from "./computer-service-ownership-proof.ts";
import { createComputerServiceUpgradeControlHandler } from "./computer-service-upgrade-control.ts";

export const NODE_K_CARRIER_COMPUTER_SERVICE_OWNERSHIP_HOST_ID =
  "computer-service";
export const NODE_K_CARRIER_COMPUTER_SERVICE_UPGRADE_CONTROL_HOST_ID =
  "computer-service-upgrade-control";

export type NodeKCarrierComputerServiceWorkload = Readonly<{
  holdManagedAttachments(
    expected: Readonly<Record<string, string>>,
  ): Promise<void>;
  managedAttachmentIdentities(): Promise<Readonly<Record<string, string>>>;
  ready(): Promise<void>;
  releaseManagedAttachmentsHold(): Promise<void>;
  run(input: { signal: AbortSignal }): Promise<void>;
}>;

export type NodeKCarrierComputerServiceSignalSource = Readonly<{
  off(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}>;

export type NodeKCarrierComputerServiceProcessOptions = Readonly<{
  buildVersion: string;
  computerInstanceId?: string;
  ownershipControlToken: string;
  processId?: number;
  serviceGeneration?: string;
  shutdownSignal?: AbortSignal;
  signalSource?: NodeKCarrierComputerServiceSignalSource;
  socketDirectory: string;
  sourceProcessId?: number;
  startupRecovery?: () => Promise<unknown>;
  upgradeControlToken: string;
  workload: NodeKCarrierComputerServiceWorkload;
}>;

/**
 * One process-level owner for the replaceable Computer service. It couples the
 * live attachment workload to singleton attestation, generation-fenced
 * upgrade hold/release, startup recovery, and shutdown. It owns no Room or
 * Placement truth; those remain behind the workload's Computer application
 * ports.
 */
export async function runNodeKCarrierComputerServiceProcess(
  options: NodeKCarrierComputerServiceProcessOptions,
): Promise<Readonly<{ kind: "stopped" }>> {
  const buildVersion = identifier(options.buildVersion, "buildVersion", 128);
  const computerInstanceId = identifier(
    options.computerInstanceId ?? randomUUID(),
    "computerInstanceId",
    512,
  );
  const processId = positiveInteger(
    options.processId ?? process.pid,
    "processId",
  );
  const serviceGeneration = identifier(
    options.serviceGeneration ?? randomUUID(),
    "serviceGeneration",
    512,
  );
  const sourceProcessId = positiveInteger(
    options.sourceProcessId ?? Math.max(1, process.ppid),
    "sourceProcessId",
  );
  const shutdown = new AbortController();
  const requestShutdown = () => shutdown.abort("Computer service stopped");
  const signalSource = options.signalSource ?? process;
  const externalShutdown = options.shutdownSignal;
  const onExternalShutdown = () => shutdown.abort(externalShutdown?.reason);
  signalSource.once("SIGINT", requestShutdown);
  signalSource.once("SIGTERM", requestShutdown);
  externalShutdown?.addEventListener("abort", onExternalShutdown, {
    once: true,
  });
  if (externalShutdown?.aborted) onExternalShutdown();

  const currentIdentities = async () =>
    attachmentIdentities(await options.workload.managedAttachmentIdentities());
  const ownership = new UnixSocketInstanceLock({
    directory: options.socketDirectory,
    handleConnection: createComputerServiceOwnershipProofHandler({
      attestation: async () => {
        await options.workload.ready();
        const identities = await currentIdentities();
        return Object.freeze({
          buildVersion,
          candidateComputerInstanceId: computerInstanceId,
          candidateProcessId: processId,
          managedAttachmentIds: Object.freeze(Object.keys(identities)),
          managedAttachmentIdentities: identities,
          serviceGeneration,
          sourceProcessId,
        });
      },
      controlToken: options.ownershipControlToken,
      processId,
    }),
    hostId: NODE_K_CARRIER_COMPUTER_SERVICE_OWNERSHIP_HOST_ID,
  });
  const upgradeControl = new UnixSocketInstanceLock({
    directory: options.socketDirectory,
    handleConnection: createComputerServiceUpgradeControlHandler({
      controlToken: options.upgradeControlToken,
      holdManagedAttachments: async (expected) => {
        const current = await currentIdentities();
        if (!sameAttachmentIdentities(current, expected)) {
          throw new Error("managed attachment set changed before hold");
        }
        await options.workload.holdManagedAttachments(current);
      },
      processId,
      releaseManagedAttachmentsHold: async () =>
        await options.workload.releaseManagedAttachmentsHold(),
      scheduleStop: requestShutdown,
      serviceGeneration,
    }),
    hostId: NODE_K_CARRIER_COMPUTER_SERVICE_UPGRADE_CONTROL_HOST_ID,
  });

  let ownershipAcquired = false;
  let upgradeControlAcquired = false;
  let workloadRun: Promise<void> | undefined;
  try {
    await ownership.acquire();
    ownershipAcquired = true;
    await upgradeControl.acquire();
    upgradeControlAcquired = true;
    workloadRun = options.workload.run({ signal: shutdown.signal });
    await options.workload.ready();
    await Promise.all([
      workloadRun,
      options.startupRecovery?.() ?? Promise.resolve(),
    ]);
    return Object.freeze({ kind: "stopped" });
  } catch (error) {
    shutdown.abort(error);
    await workloadRun?.catch(() => undefined);
    throw error;
  } finally {
    shutdown.abort("Computer service cleanup");
    await workloadRun?.catch(() => undefined);
    if (upgradeControlAcquired) await upgradeControl.release();
    if (ownershipAcquired) await ownership.release();
    signalSource.off("SIGINT", requestShutdown);
    signalSource.off("SIGTERM", requestShutdown);
    externalShutdown?.removeEventListener("abort", onExternalShutdown);
  }
}

function attachmentIdentities(
  value: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("managed attachment identities must be an object");
  }
  const keys = Object.keys(value).sort();
  if (keys.length > 128) {
    throw new Error("managed attachment identities exceed 128 entries");
  }
  const output: Record<string, string> = {};
  const seenConnections = new Set<string>();
  for (const key of keys) {
    const attachmentId = identifier(key, "attachmentId", 256);
    const connectionId = identifier(
      value[key],
      `managedAttachmentIdentities.${attachmentId}`,
      512,
    );
    if (seenConnections.has(connectionId)) {
      throw new Error(
        "managed attachment connection identities must be unique",
      );
    }
    seenConnections.add(connectionId);
    Object.defineProperty(output, attachmentId, {
      configurable: false,
      enumerable: true,
      value: connectionId,
      writable: false,
    });
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

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}
