import { withRuntimeExecutionWorkspace } from "@rah-os/agent-host";
import {
  RuntimeLaunchEnvironmentSchema,
  type RuntimeRecoveryDescriptor,
} from "@rah-os/protocol";
import { join } from "node:path";

import {
  resolveRuntimeDeliveryMode,
  type AgentMemoryCoordinator,
  combineActivationEnvironmentLeases,
  createWorkerToolTransportEnvironment,
  prepareAgentMemoryRun,
  RuntimeCredentialEnvironmentBinding,
  RuntimeImplementationRegistry,
  ProviderSessionStore,
  RuntimeProfileRegistry,
  assertRuntimeProfileRevisionStillActive,
  type ActivationEnvelope,
  type ActivationEnvironmentLease,
  type InstanceRuntimePool,
  type RuntimeCreationOptions,
  type RuntimeAdapter,
} from "@rah-os/agent-host";
import type { WorkerApplicationService } from "@rah-os/application-service";
import type { AuthenticatedHostContext, RoomKernel } from "@rah-os/core";
import type {
  InstanceMemoryIndex,
  ResolvedModel,
  RuntimeProfileProbeReport,
  RuntimeProfileRevision,
  ToolAccessMode,
} from "@rah-os/protocol";

import { deliveryAcceptanceRegistration } from "./delivery-acceptance-registration.ts";
import { selectRuntimeReplyTransport } from "./reply-transport-policy.ts";
import {
  startupMemorySystemLease,
  useSystemMemoryTransport,
} from "./startup-memory-system-lease.ts";
import { standingPromptLease } from "./standing-prompt-lease.ts";

export { assertRuntimeProfileRevisionStillActive };

/**
 * Owner 2026-09-26: the one place deciding which CLIs need the attached
 * directories as a standing-prompt fact. Claude (`--add-dir`), Codex
 * (workspace roots) and Kimi (project config) learn them natively, so a
 * prompt line would only repeat it; OpenCode serve and generic processes
 * have no native mechanism.
 */
const NATIVE_ATTACHED_DIRECTORY_ADAPTERS: ReadonlySet<string> = new Set([
  "claude-stream-json/v1",
  "codex-app-server/v1",
  "kimi-acp/v1",
]);
export function attachedDirectoriesForPrompt(
  adapterKind: string,
  directories: readonly string[],
): readonly string[] {
  return NATIVE_ATTACHED_DIRECTORY_ADAPTERS.has(adapterKind) ? [] : directories;
}

type RuntimeWorkerService = Pick<
  WorkerApplicationService,
  "issueActivationCredential" | "origin"
> &
  Partial<
    Pick<WorkerApplicationService, "issueActivationCredentialForWorkspace">
  >;

/**
 * The Kernel ports a local runtime uses under its Host credential: the S1-d
 * delivery acceptance and the S6 batch B session memory index.
 */
export function kernelRuntimePorts(kernel: RoomKernel | undefined): {
  deliveryAcceptanceKernel?: Pick<RoomKernel, "markPresentedDeliverySent">;
  memoryIndexKernel?: Pick<RoomKernel, "readInstanceMemoryIndex">;
} {
  return kernel === undefined
    ? {}
    : { deliveryAcceptanceKernel: kernel, memoryIndexKernel: kernel };
}

/** A failed index read starts the session without one, never blocks it. */
function readMemoryIndex(
  input: {
    host: AuthenticatedHostContext;
    memoryIndexKernel?: Pick<RoomKernel, "readInstanceMemoryIndex">;
  },
  participantId: string,
): InstanceMemoryIndex | undefined {
  if (input.memoryIndexKernel === undefined) return undefined;
  try {
    return input.memoryIndexKernel.readInstanceMemoryIndex(input.host, {
      participantId,
    });
  } catch (error) {
    process.stderr.write(
      `[rah-os] channel memory index unavailable for ${participantId}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return undefined;
  }
}

export function createConfiguredRuntime(input: {
  /** Owner 2026-09-26: the channel home's Human-attached directories. */
  additionalDirectories?: readonly string[] | undefined;
  /**
   * Review 2026-09-26 P1-1: throws when the channel workspace (primary or
   * attached directory) is no longer the approved/created directory. Run
   * before each activation's environment and evidence capture.
   */
  verifyWorkspace?: (() => void) | undefined;
  startupMemoryTransport?: "tool" | "system" | undefined;
  executionWorkspace?: RuntimeRecoveryDescriptor["executionWorkspace"];
  launchEnvironment?: (
    runtimeId: string,
    agentId?: string,
  ) => Record<string, string>;
  guideEnabled?: (runtimeId: string | undefined) => boolean;
  agentMemoryCoordinator?: AgentMemoryCoordinator;
  credentialEnvironment: RuntimeCredentialEnvironmentBinding;
  cwd: string;
  host: AuthenticatedHostContext;
  implementations: RuntimeImplementationRegistry;

  probeReport: RuntimeProfileProbeReport;
  /**
   * Codex and Claude (S2-c1). Present when the deployment can register a send
   * under `input.host`'s own credential once the driver reports that the
   * runtime accepted the injected wake turn. Absent for every other driver,
   * whose Activations keep the explicit `message-check` path unchanged.
   */
  deliveryAcceptanceKernel?: Pick<RoomKernel, "markPresentedDeliverySent">;
  /**
   * S6 batch B: the Kernel read of a Role instance's channel memory index at
   * session start, under `input.host`. Absent: the instance still starts
   * without the legacy MEMORY.md and finds its memory through the Worker CLI.
   */
  memoryIndexKernel?: Pick<RoomKernel, "readInstanceMemoryIndex">;
  resolvedModel?: ResolvedModel;
  toolAccessMode?: ToolAccessMode;
  runtimeProfileRegistry: RuntimeProfileRegistry;
  runtimeProfileRevision: RuntimeProfileRevision;
  supervisorDirectory: string;
  /** S2-a: when set, Codex Role instances run on warm processes. */
  warmRuntimePool?: InstanceRuntimePool | undefined;
  /**
   * Adapter kinds whose Role instances use `warmRuntimePool` (each an
   * explicit opt-in); Codex only when omitted.
   */
  warmRuntimeKinds?: ReadonlySet<string> | undefined;
  workerService: RuntimeWorkerService;
}): RuntimeAdapter {
  const attachedDirectories = [...(input.additionalDirectories ?? [])];
  let runtime: RuntimeAdapter;
  /**
   * The runtime-level lease (secrets, launch env, memory, standing prompt).
   * The per-Activation path appends the Worker credential to it; a warm
   * runtime keeps it for the process lifetime and issues credentials per turn.
   */
  const runtimeLeases = async (
    scope: ActivationEnvelope,
  ): Promise<ActivationEnvironmentLease[]> => {
    input.verifyWorkspace?.();
    const runtimeId = (
      {
        "codex-app-server/v1": "codex",
        "codex-exec/v1": "codex",
        "claude-stream-json/v1": "claude",
        "kimi-acp/v1": "kimi",
        "opencode-server/v1": "opencode",
        "pi-print-json/v1": "pi",
        "agy-print-json/v1": "agy",
      } as Record<string, string>
    )[input.runtimeProfileRevision.manifest.adapter.kind];
    const launchEnv =
      input.launchEnvironment?.(
        runtimeId ?? "unknown",
        scope.agent?.agentDefinitionRevision.agentId,
      ) ?? {};
    const roleEnvironment = RuntimeLaunchEnvironmentSchema.parse(
      scope.agent?.agentDefinitionRevision.environment ?? {},
    );
    const secretLease = await input.credentialEnvironment.resolve();
    const leases: ActivationEnvironmentLease[] = [
      secretLease,
      {
        env: {
          ...launchEnv,
          ...roleEnvironment,
        },
      },
    ];
    try {
      if (scope.agent !== undefined) {
        const deliveryMode = resolveRuntimeDeliveryMode(
          runtime,
          input.guideEnabled?.(runtime.guideRuntimeId) === true,
        );
        // S6 batch B: every Role instance is an S6 session (only instances
        // have channel memory). It gets the channel index and never the
        // legacy per-instance MEMORY.md, whose directory stays untouched.
        const s6 = scope.agent.instanceChannelId !== undefined;
        const memoryIndex = s6
          ? readMemoryIndex(input, scope.agent.participantId)
          : undefined;
        const promptLease = standingPromptLease(scope, {
          ...(!s6
            ? {}
            : {
                channelMemory: {
                  index: memoryIndex,
                  // OpenCode and Pi rebuild their system layer from the launch
                  // prompt on every request; others keep the first one.
                  carryIndexSeq:
                    scope.agent.instanceSessionRequired !== true ||
                    runtimeId === "opencode" ||
                    runtimeId === "pi",
                },
              }),
          deliveryMode,
          ...(runtimeId === "claude" && deliveryMode === "direct"
            ? { previousDeliveryMode: "gated" }
            : {}),
          ...(input.toolAccessMode === undefined
            ? {}
            : { toolAccessMode: input.toolAccessMode }),
          workspacePath: input.cwd,
          attachedDirectories: attachedDirectoriesForPrompt(
            input.runtimeProfileRevision.manifest.adapter.kind,
            attachedDirectories,
          ),
        });
        const activation = {
          activationId: scope.activationId,
          computerHostId: scope.hostId,
          roomId: scope.roomId,
          runAttemptId: scope.runAttemptId,
        };
        const memoryLease: ActivationEnvironmentLease = s6
          ? { env: {} }
          : input.agentMemoryCoordinator === undefined
            ? await prepareAgentMemoryRun({
                activation,
                agent: scope.agent,
                executionCwd: input.cwd,
                rootDirectory: join(input.supervisorDirectory, "agent-memory"),
              })
            : await input.agentMemoryCoordinator.prepareRuntimeActivation(
                scope.agent,
                activation,
                { cwd: input.cwd },
              );
        leases.push(memoryLease);
        if (promptLease !== undefined) {
          leases.push(
            useSystemMemoryTransport(input.startupMemoryTransport, runtimeId) &&
              memoryLease.env.RAH_AGENT_MEMORY_DIR !== undefined
              ? await startupMemorySystemLease({
                  participantId: scope.agent.participantId,
                  memoryDirectory: memoryLease.env.RAH_AGENT_MEMORY_DIR,
                  promptLease,
                })
              : promptLease,
          );
        }
      }
      return leases;
    } catch (error) {
      try {
        await combineActivationEnvironmentLeases(
          leases,
          "local Runtime activation setup cleanup failed",
        ).release?.();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "local Runtime activation setup and cleanup failed",
        );
      }
      throw error;
    }
  };
  const issueWorkerCredential = async (scope: ActivationEnvelope) => {
    input.verifyWorkspace?.();
    return await issueVerifiedWorkerCredential(scope);
  };
  const issueVerifiedWorkerCredential = async (scope: ActivationEnvelope) =>
    typeof input.workerService.issueActivationCredentialForWorkspace ===
    "function"
      ? await input.workerService.issueActivationCredentialForWorkspace(
          input.host,
          scope,
          {
            workspaceRoot: input.cwd,
            ...(attachedDirectories.length === 0
              ? {}
              : { attachedDirectories }),
          },
        )
      : input.workerService.issueActivationCredential(input.host, scope);
  const creationOptions = {
    activationEnvironment: async (scope: ActivationEnvelope) => {
      const leases = await runtimeLeases(scope);
      try {
        const credential = await issueWorkerCredential(scope);
        const workerLease = await createWorkerToolTransportEnvironment({
          credentialDirectory: join(
            input.supervisorDirectory,
            "worker-credentials",
          ),
          revokeCredential: credential.revoke,
          workerAccessToken: credential.accessToken,
          workerApiOrigin: input.workerService.origin,
        });
        leases.push(workerLease);
        return combineActivationEnvironmentLeases(
          leases,
          "local Runtime activation environment release failed",
        );
      } catch (error) {
        try {
          await combineActivationEnvironmentLeases(
            leases,
            "local Runtime activation setup cleanup failed",
          ).release?.();
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "local Runtime activation setup and cleanup failed",
          );
        }
        throw error;
      }
    },
    beforeStart: () =>
      assertRuntimeProfileRevisionStillActive(
        input.runtimeProfileRegistry,
        input.runtimeProfileRevision,
      ),
    cwd: input.cwd,
    ...(attachedDirectories.length === 0
      ? {}
      : { additionalDirectories: attachedDirectories }),
    providerSessionStore: new ProviderSessionStore({
      rootDirectory: join(input.supervisorDirectory, "provider-sessions"),
    }),
    ...(input.deliveryAcceptanceKernel === undefined
      ? {}
      : {
          recordDeliveryAcceptance: ((register) => (scope) => {
            register({
              activationId: scope.activationId,
              consumerId: scope.consumerId,
              runAttemptId: scope.runAttemptId,
            });
          })(
            deliveryAcceptanceRegistration(
              input.deliveryAcceptanceKernel,
              input.host,
            ),
          ),
        }),
    nativeFinalText:
      selectRuntimeReplyTransport({
        adapterKind: input.runtimeProfileRevision.manifest.adapter.kind,
        entry: "cold",
      }) === "native-final",
    supervisorDirectory: input.supervisorDirectory,
  } satisfies RuntimeCreationOptions;
  const warmReplyTransport = selectRuntimeReplyTransport({
    adapterKind: input.runtimeProfileRevision.manifest.adapter.kind,
    entry: "warm",
  });
  runtime =
    input.warmRuntimePool !== undefined &&
    (input.warmRuntimeKinds ?? new Set(["codex-app-server/v1"])).has(
      input.runtimeProfileRevision.manifest.adapter.kind,
    )
      ? input.implementations.createWarmRuntime(
          input.runtimeProfileRevision,
          input.probeReport,
          creationOptions,
          {
            nativeFinalText: warmReplyTransport === "native-final",
            explicitFinalOutput: warmReplyTransport === "explicit-final",
            issueWorkerCredential,
            pool: input.warmRuntimePool,
            runtimeEnvironment: async (scope) =>
              combineActivationEnvironmentLeases(
                await runtimeLeases(scope),
                "warm Runtime environment release failed",
              ),
            workerApiOrigin: input.workerService.origin,
          },
          input.resolvedModel,
          input.toolAccessMode,
        )
      : input.implementations.createRuntime(
          input.runtimeProfileRevision,
          input.probeReport,
          creationOptions,
          input.resolvedModel,
          input.toolAccessMode,
        );
  return input.executionWorkspace
    ? withRuntimeExecutionWorkspace(runtime, input.executionWorkspace)
    : runtime;
}

/** Share credential resolver construction across the v3/v4 composition paths. */
export function createConfiguredCredentialEnvironment(
  manifest: RuntimeProfileRevision["manifest"],
  bindings: Record<
    string,
    Parameters<import("@rah-os/agent-host").SecretProvider["load"]>[0]
  >,
  secrets: import("@rah-os/agent-host").SecretProvider,
): RuntimeCredentialEnvironmentBinding {
  return new RuntimeCredentialEnvironmentBinding({
    manifest,
    resolvers: Object.fromEntries(
      Object.entries(bindings).map(([slotId, reference]) => [
        slotId,
        async () => await secrets.load(reference),
      ]),
    ),
  });
}
