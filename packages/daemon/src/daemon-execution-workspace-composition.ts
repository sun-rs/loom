import { mkdirSync, realpathSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  AgentExecutionWorkspaceCatalog,
  createChannelHome,
  reservedChannelDirectories,
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
          reservedDirectories: reservedChannelDirectories({
            stateDirectory: config.stateDirectory,
            channelWorkspaceRoot: defaultChannelWorkspaceRoot(config),
          }),
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
      .then(async () => {
        const mounts = await executionWorkspaces!.refresh(
          kernel.listHostExecutionWorkspaceBindings(host),
        );
        try {
          // Host observation for the Room projection; a Channel unbound
          // since the refresh is simply reported again next time.
          kernel.reportChannelWorkspaceStates(
            host,
            executionWorkspaces!.channelHomeStates(),
          );
        } catch {
          // Not a mount failure: placement already uses `mounts`.
        }
        return mounts;
      });
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
      // Review P1-1: re-verify the channel workspace before each
      // activation's environment and delivery evidence capture.
      ...(placement
        ? {
            verifyWorkspace: () => {
              executionWorkspaces!.resolveWorkspace(placement);
            },
          }
        : {}),
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

/**
 * Owner 2026-09-26: the Core-side Host hooks of a Channel workspace: the
 * check of Human-attached directories, and (P2-2 option A) the creation of
 * the primary directory `<root>/<roomId>` during Channel creation. The
 * records are the execution catalog's (`createChannelHome`), so the first
 * binding verifies exactly this directory. Crash after the directory is
 * created but before the Kernel commit leaves an empty directory with Loom
 * records for a room id that never exists and is never reused; it is not
 * adopted by any other Channel.
 */
export function channelWorkspaceCoreOptions(config: DaemonConfig) {
  if (config.schemaVersion !== 4) return {};
  const root = resolve(defaultChannelWorkspaceRoot(config));
  return {
    channelAttachedDirectoryValidator: createChannelAttachedDirectoryValidator({
      stateDirectory: config.stateDirectory,
      channelWorkspaceRoot: root,
    }),
    channelPrimaryDirectoryPreparer: (roomId: string) => {
      // The recorded path is canonical: every later check requires
      // realpath(path) === path (a configured root may sit under a symlink).
      mkdirSync(root, { recursive: true, mode: 0o700 });
      return createChannelHome({
        rootDirectory: join(
          realpathSync(config.stateDirectory),
          "agent-workspaces",
        ),
        roomId,
        defaultCwd: join(realpathSync(root), roomId),
      });
    },
  };
}
