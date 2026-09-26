import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  AgentExecutionWorkspaceCatalog,
  readAgentExecutionResetReceipt,
  type AgentExecutionResetCoordinator,
} from "@rah-os/agent-host";
import type { AuthenticatedHostContext, RoomKernel } from "@rah-os/kernel";
import type {
  PlacementDecision,
  RuntimeRecoveryDescriptor,
  WorkspaceMountDescriptor,
} from "@rah-os/protocol";
import { createChannelAttachedDirectoryValidator } from "./channel-attached-directory-validator.ts";
import type { DaemonConfig } from "./config.ts";
import type { RuntimeOfferPublisher } from "./runtime-offer-publisher.ts";

/** Host-local workspace composition; Kernel and reset coordinator retain durable ownership. */
export async function createDaemonExecutionWorkspaceComposition(input: {
  config: DaemonConfig;
  host: AuthenticatedHostContext;
  kernel: RoomKernel;
}) {
  const { config, host, kernel } = input;
  const completedWorkspaceResets = new Map<
    string,
    NonNullable<Awaited<ReturnType<typeof readAgentExecutionResetReceipt>>>
  >();
  const executionWorkspaces =
    config.schemaVersion === 4
      ? await AgentExecutionWorkspaceCatalog.open({
          rootDirectory: join(
            await realpath(config.stateDirectory),
            "agent-workspaces",
          ),
          channelHomeRoot: defaultChannelWorkspaceRoot(config),
          legacyCwd: config.workspace.cwd,
          isResetCommitted: async (owner, operationId) => {
            const receipt = await readAgentExecutionResetReceipt(
              join(
                config.stateDirectory,
                "supervisors",
                "agent-execution-reset",
              ),
              operationId,
            );
            if (receipt === null) return false;
            if (
              receipt.ownerParticipantId !== owner ||
              receipt.operationId !== operationId ||
              receipt.mode !== "full" ||
              receipt.computerHostId !== host.hostId
            )
              throw new Error("Execution reset receipt identity mismatch");
            completedWorkspaceResets.set(operationId, receipt);
            return true;
          },
          legacyMount: {
            modes: [config.workspace.mode],
            workspaceDefinitionId: config.workspace.workspaceDefinitionId,
            workspaceMountRevisionId: config.workspace.workspaceMountRevisionId,
            workspaceMountDigest: config.workspace.workspaceMountDigest,
          },
        })
      : undefined;
  let workspaceRefresh = Promise.resolve([] as WorkspaceMountDescriptor[]);
  const refreshExecutionWorkspaces = () => {
    workspaceRefresh = workspaceRefresh
      .catch(() => [])
      .then(() =>
        executionWorkspaces!.refresh(
          kernel.listHostExecutionWorkspaceBindings(host),
        ),
      );
    return workspaceRefresh;
  };
  function resolveRuntimeWorkspace(
    placement: PlacementDecision | undefined,
    legacyCwd: string,
  ) {
    const resolved = placement
      ? executionWorkspaces!.resolveWorkspace(placement)
      : { cwd: legacyCwd, additionalDirectories: [] };
    return {
      cwd: resolved.cwd,
      ...(resolved.additionalDirectories.length === 0
        ? {}
        : { additionalDirectories: [...resolved.additionalDirectories] }),
      ...(placement
        ? {
            executionWorkspace: {
              participantId: placement.participantId,
              workspaceDefinitionId: placement.workspaceDefinitionId,
              workspaceMountRevisionId: placement.workspaceMountRevisionId,
              workspaceMountDigest: placement.workspaceMountDigest,
            },
          }
        : {}),
    };
  }
  function createRecoveryCwdResolver(legacyCwd: string) {
    return (descriptor: RuntimeRecoveryDescriptor) =>
      descriptor.executionWorkspace
        ? executionWorkspaces!.resolveFrozen(descriptor.executionWorkspace)
        : legacyCwd;
  }
  function createLifecycle(
    resetCoordinator: AgentExecutionResetCoordinator,
    publishers: RuntimeOfferPublisher[],
  ) {
    return {
      afterOnline: async () => {
        for (const receipt of completedWorkspaceResets.values()) {
          await resetCoordinator.reset({
            agentId: receipt.agentId,
            mode: receipt.mode,
            operationId: receipt.operationId,
            ownerParticipantId: receipt.ownerParticipantId,
          });
        }
        for (const publisher of publishers) {
          await publisher.refreshWorkspaceMounts();
          publisher.publishAvailable();
        }
      },
      beforeDraining: () => {
        for (const publisher of publishers) {
          publisher.publishUnavailable();
        }
      },
    };
  }
  return {
    executionWorkspaces,
    refreshExecutionWorkspaces,
    resolveRuntimeWorkspace,
    createRecoveryCwdResolver,
    createLifecycle,
  };
}

export function legacyWorkspaceMountDescriptors(
  workspace: Extract<DaemonConfig, { schemaVersion: 4 }>["workspace"],
): WorkspaceMountDescriptor[] {
  return [
    {
      modes: [workspace.mode],
      workspaceDefinitionId: workspace.workspaceDefinitionId,
      workspaceMountDigest: workspace.workspaceMountDigest,
      workspaceMountRevisionId: workspace.workspaceMountRevisionId,
    },
  ];
}

/**
 * Owner 2026-09-26: parent of the platform-created Channel homes. Default
 * `~/.loom/channel-workspaces`; tests and deployments inject another root.
 */
export function defaultChannelWorkspaceRoot(
  config: { channelWorkspaceRoot?: string | undefined },
  home: string = homedir(),
): string {
  return (
    config.channelWorkspaceRoot ?? join(home, ".loom", "channel-workspaces")
  );
}

/** Owner 2026-09-26: the Core-side check of Human-attached Channel directories. */
export function channelWorkspaceCoreOptions(config: DaemonConfig) {
  return config.schemaVersion === 4
    ? {
        channelAttachedDirectoryValidator:
          createChannelAttachedDirectoryValidator({
            stateDirectory: config.stateDirectory,
            channelWorkspaceRoot: defaultChannelWorkspaceRoot(config),
          }),
      }
    : {};
}
