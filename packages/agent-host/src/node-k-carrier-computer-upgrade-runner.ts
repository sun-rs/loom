import {
  ComputerUpgradeCoordinatorRunner,
  type ComputerUpgradeCoordinatorCreationContext,
  type ComputerUpgradeCoordinatorRunnerOptions,
} from "./computer-upgrade-coordinator-runner.ts";
import {
  ComputerUpgradeCoordinatorRequestStore,
  type ComputerUpgradeCoordinatorRequest,
} from "./computer-upgrade-coordinator-process.ts";
import {
  ComputerAttachmentStore,
  type ComputerAttachment,
} from "./computer-attachment-store.ts";
import { ComputerOperationReceiptStore } from "./computer-operation-receipt-store.ts";
import {
  ComputerResidentService,
  type ComputerControlClientPort,
} from "./computer-resident-service.ts";
import {
  ComputerUpgradeParkedAttachmentStore,
  KCarrierComputerHostAdapter,
} from "./k-carrier-computer-host-adapter.ts";
import {
  createKCarrierComputerUpgradeCoordinator,
  type ComputerReleaseSourcePort,
  type ManagedComputerUpgradeControlPort,
} from "./k-carrier-computer-upgrade.ts";
import {
  NodeKCarrierComputerServiceHost,
  type NodeKCarrierComputerServiceHostOptions,
} from "./node-k-carrier-computer-service-host.ts";
import {
  NodeKCarrierSlotServiceLauncher,
  type KCarrierSlotServiceLaunch,
} from "./node-k-carrier-slot-service-launcher.ts";
import { NodeHttpComputerControlClient } from "./node-http-computer-control-client.ts";
import { NodeComputerServiceSupervisorControlClient } from "./computer-service-supervisor-control.ts";
import type { ComputerOperationAcknowledgeRequest } from "@rah-os/computer-protocol";

export type AttachmentBoundComputerUpgradeControlOptions = Readonly<{
  attachmentStore: Pick<ComputerAttachmentStore, "read">;
  createClient?: (attachment: ComputerAttachment) => ComputerControlClientPort;
  processId?: number;
  request: ComputerUpgradeCoordinatorRequest;
  runtimeProtocolVersion: number;
  serviceIdentity?: Readonly<{
    buildVersion: string;
    computerInstanceId: string;
  }>;
}>;

/**
 * Reopens only the Server attachment that claimed this operation. The frozen
 * connection identity is checked before a Host credential is used, so a
 * catalog reorder or replacement cannot silently redirect upgrade receipts.
 */
export async function createAttachmentBoundComputerUpgradeControl(
  options: AttachmentBoundComputerUpgradeControlOptions,
): Promise<ManagedComputerUpgradeControlPort> {
  const attachments = await options.attachmentStore.read();
  const attachment = attachments.find(
    (candidate) =>
      candidate.attachmentId === options.request.controlAttachmentId,
  );
  if (attachment === undefined) {
    throw new Error(
      "the operation-owning Computer attachment is no longer configured",
    );
  }
  if (
    options.request.managedAttachmentIdentities[attachment.attachmentId] !==
    attachment.connectionId
  ) {
    throw new Error(
      "the operation-owning Computer attachment does not match the frozen operation identity",
    );
  }
  const client =
    options.createClient?.(attachment) ??
    new NodeHttpComputerControlClient({
      hostAccessToken: attachment.hostAccessToken,
      origin: attachment.origin,
    });
  const serviceIdentity = options.serviceIdentity ?? {
    buildVersion: options.request.sourceBuildVersion,
    computerInstanceId: options.request.sourceComputerInstanceId,
  };
  if (options.serviceIdentity !== undefined) {
    if (
      serviceIdentity.buildVersion !== options.request.targetBuildVersion ||
      serviceIdentity.computerInstanceId ===
        options.request.sourceComputerInstanceId
    ) {
      throw new Error(
        "successor upgrade control requires the frozen target build and a new Computer instance",
      );
    }
  }
  const resident = new ComputerResidentService({
    buildVersion: serviceIdentity.buildVersion,
    client,
    computerInstanceId: serviceIdentity.computerInstanceId,
    connectionId: attachment.connectionId,
    ...(options.processId === undefined
      ? {}
      : { processId: options.processId }),
    runtimeOffers: async () => [],
    runtimeProtocolVersion: options.runtimeProtocolVersion,
  });
  return Object.freeze({
    acknowledgeOperation: (request: ComputerOperationAcknowledgeRequest) =>
      resident.acknowledgeOperation(request),
  });
}

export type NodeKCarrierComputerUpgradeRunnerOptions = Readonly<{
  argumentPrefix?: readonly string[];
  control?: ManagedComputerUpgradeControlPort;
  createControl?: (
    request: ComputerUpgradeCoordinatorRequest,
    context: ComputerUpgradeCoordinatorCreationContext,
  ) =>
    | ManagedComputerUpgradeControlPort
    | Promise<ManagedComputerUpgradeControlPort>;
  onSlotServiceLaunched?(launch: KCarrierSlotServiceLaunch): void;
  ownershipControlToken: string;
  ownershipSocketPath: string;
  receiptStatePath: string;
  releaseSource: ComputerReleaseSourcePort;
  requestPath: string;
  requestTimeoutMs?: number;
  resumePollIntervalMs?: number;
  resumeTimeoutMs?: number;
  serviceConfigurationPath: string;
  startReadyPollIntervalMs?: number;
  startReadyTimeoutMs?: number;
  stateDir: string;
  stopPollIntervalMs?: number;
  stopTimeoutMs?: number;
  supervisorControlSocketPath?: string;
  supervisorControlTimeoutMs?: number;
  supervisorControlToken?: string;
  upgradeControlSocketPath: string;
  upgradeControlToken: string;
}>;

/**
 * The one Node composition for a detached K transaction. Callers supply only
 * transport/release ports and owner-private local paths/capabilities; they do
 * not reassemble slot, park, receipt, or process ownership in another root.
 */
export function createNodeKCarrierComputerUpgradeRunner(
  options: NodeKCarrierComputerUpgradeRunnerOptions,
): ComputerUpgradeCoordinatorRunner {
  if (
    (options.control === undefined) ===
    (options.createControl === undefined)
  ) {
    throw new Error(
      "K Computer upgrade runner requires exactly one control owner",
    );
  }
  if (
    (options.supervisorControlSocketPath === undefined) !==
    (options.supervisorControlToken === undefined)
  ) {
    throw new Error(
      "K Computer upgrade runner supervisor socket and token must be configured together",
    );
  }
  const requestStore = new ComputerUpgradeCoordinatorRequestStore({
    requestPath: options.requestPath,
  });
  const receipts = new ComputerOperationReceiptStore({
    statePath: options.receiptStatePath,
  });
  const parkedStore = new ComputerUpgradeParkedAttachmentStore({
    stateDir: options.stateDir,
  });
  const slotLauncher = new NodeKCarrierSlotServiceLauncher({
    ...(options.argumentPrefix === undefined
      ? {}
      : { argumentPrefix: options.argumentPrefix }),
    configurationPath: options.serviceConfigurationPath,
    stateDir: options.stateDir,
  });
  const createCoordinator: ComputerUpgradeCoordinatorRunnerOptions["createCoordinator"] =
    async (request, context) => {
      const control =
        options.createControl === undefined
          ? options.control!
          : await options.createControl(request, context);
      const lifecycleOwner:
        | Pick<NodeKCarrierComputerServiceHostOptions, "launchSlotService">
        | Pick<NodeKCarrierComputerServiceHostOptions, "supervisor"> =
        options.supervisorControlSocketPath === undefined
          ? {
              launchSlotService: async (slot) => {
                const launched = await slotLauncher.launch(slot);
                options.onSlotServiceLaunched?.(launched);
              },
            }
          : {
              supervisor: new NodeComputerServiceSupervisorControlClient({
                controlToken: options.supervisorControlToken!,
                socketPath: options.supervisorControlSocketPath,
                ...(options.supervisorControlTimeoutMs === undefined
                  ? {}
                  : { timeoutMs: options.supervisorControlTimeoutMs }),
              }),
            };
      const serviceOptions: NodeKCarrierComputerServiceHostOptions = {
        ...lifecycleOwner,
        ownershipControlToken: options.ownershipControlToken,
        ownershipSocketPath: options.ownershipSocketPath,
        ...(options.requestTimeoutMs === undefined
          ? {}
          : { requestTimeoutMs: options.requestTimeoutMs }),
        ...(options.stopPollIntervalMs === undefined
          ? {}
          : { stopPollIntervalMs: options.stopPollIntervalMs }),
        ...(options.stopTimeoutMs === undefined
          ? {}
          : { stopTimeoutMs: options.stopTimeoutMs }),
        upgradeControlSocketPath: options.upgradeControlSocketPath,
        upgradeControlToken: options.upgradeControlToken,
      };
      const service = new NodeKCarrierComputerServiceHost(serviceOptions);
      return createKCarrierComputerUpgradeCoordinator({
        control,
        host: new KCarrierComputerHostAdapter({
          expectedManagedAttachmentIdentities:
            request.managedAttachmentIdentities,
          parkedStore,
          ...(options.resumePollIntervalMs === undefined
            ? {}
            : { resumePollIntervalMs: options.resumePollIntervalMs }),
          ...(options.resumeTimeoutMs === undefined
            ? {}
            : { resumeTimeoutMs: options.resumeTimeoutMs }),
          service,
          ...(options.startReadyPollIntervalMs === undefined
            ? {}
            : {
                startReadyPollIntervalMs: options.startReadyPollIntervalMs,
              }),
          ...(options.startReadyTimeoutMs === undefined
            ? {}
            : { startReadyTimeoutMs: options.startReadyTimeoutMs }),
        }),
        receipts,
        releaseSource: options.releaseSource,
        stateDir: options.stateDir,
      });
    };
  return new ComputerUpgradeCoordinatorRunner({
    createCoordinator,
    requestStore,
    stateDir: options.stateDir,
  });
}
