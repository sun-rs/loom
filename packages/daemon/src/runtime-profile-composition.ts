import { withRuntimeExecutionWorkspace } from "@rah-os/agent-host";
import type { RuntimeRecoveryDescriptor } from "@rah-os/protocol";
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
  type RuntimeAdapter,
} from "@rah-os/agent-host";
import type { WorkerApplicationService } from "@rah-os/application-service";
import type { AuthenticatedHostContext } from "@rah-os/core";
import type {
  ResolvedModel,
  RuntimeProfileProbeReport,
  RuntimeProfileRevision,
  ToolAccessMode,
} from "@rah-os/protocol";

import { standingPromptLease } from "./standing-prompt-lease.ts";

export { assertRuntimeProfileRevisionStillActive };

type RuntimeWorkerService = Pick<
  WorkerApplicationService,
  "issueActivationCredential" | "origin"
> &
  Partial<
    Pick<WorkerApplicationService, "issueActivationCredentialForWorkspace">
  >;

export function createConfiguredRuntime(input: {
  executionWorkspace?: RuntimeRecoveryDescriptor["executionWorkspace"];
  launchEnvironment?: (runtimeId: string) => Record<string, string>;
  guideEnabled?: (runtimeId: string | undefined) => boolean;
  agentMemoryCoordinator?: AgentMemoryCoordinator;
  credentialEnvironment: RuntimeCredentialEnvironmentBinding;
  cwd: string;
  host: AuthenticatedHostContext;
  implementations: RuntimeImplementationRegistry;

  probeReport: RuntimeProfileProbeReport;
  resolvedModel?: ResolvedModel;
  toolAccessMode?: ToolAccessMode;
  runtimeProfileRegistry: RuntimeProfileRegistry;
  runtimeProfileRevision: RuntimeProfileRevision;
  supervisorDirectory: string;
  workerService: RuntimeWorkerService;
}): RuntimeAdapter {
  const runtime = input.implementations.createRuntime(
    input.runtimeProfileRevision,
    input.probeReport,
    {
      activationEnvironment: async (scope) => {
        const runtimeId = (
          {
            "codex-app-server/v1": "codex",
            "claude-stream-json/v1": "claude",
            "kimi-acp/v1": "kimi",
            "opencode-server/v1": "opencode",
          } as Record<string, string>
        )[input.runtimeProfileRevision.manifest.adapter.kind];
        const launchEnv =
          input.launchEnvironment?.(runtimeId ?? "unknown") ?? {};
        const secretLease = await input.credentialEnvironment.resolve();
        const leases = [secretLease, { env: launchEnv }];
        try {
          if (scope.agent !== undefined) {
            const promptLease = standingPromptLease(scope, {
              deliveryMode: resolveRuntimeDeliveryMode(
                runtime,
                input.guideEnabled?.(runtime.guideRuntimeId) === true,
              ),
              ...(input.toolAccessMode === undefined
                ? {}
                : { toolAccessMode: input.toolAccessMode }),
              workspacePath: input.cwd,
            });
            if (promptLease !== undefined) {
              leases.push(promptLease);
            }
            const activation = {
              activationId: scope.activationId,
              computerHostId: scope.hostId,
              roomId: scope.roomId,
              runAttemptId: scope.runAttemptId,
            };
            leases.push(
              input.agentMemoryCoordinator === undefined
                ? await prepareAgentMemoryRun({
                    activation,
                    agent: scope.agent,
                    executionCwd: input.cwd,
                    rootDirectory: join(
                      input.supervisorDirectory,
                      "agent-memory",
                    ),
                  })
                : await input.agentMemoryCoordinator.prepareRuntimeActivation(
                    scope.agent,
                    activation,
                    { cwd: input.cwd },
                  ),
            );
          }
          const credential =
            typeof input.workerService.issueActivationCredentialForWorkspace ===
            "function"
              ? await input.workerService.issueActivationCredentialForWorkspace(
                  input.host,
                  scope,
                  { workspaceRoot: input.cwd },
                )
              : input.workerService.issueActivationCredential(
                  input.host,
                  scope,
                );
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
      providerSessionStore: new ProviderSessionStore({
        rootDirectory: join(input.supervisorDirectory, "provider-sessions"),
      }),
      supervisorDirectory: input.supervisorDirectory,
    },
    input.resolvedModel,
    input.toolAccessMode,
  );
  return input.executionWorkspace
    ? withRuntimeExecutionWorkspace(runtime, input.executionWorkspace)
    : runtime;
}
