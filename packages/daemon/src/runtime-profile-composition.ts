import { join } from "node:path";

import {
  type AgentMemoryCoordinator,
  combineActivationEnvironmentLeases,
  createWorkerToolTransportEnvironment,
  NodeHttpManagedMcpWorkerClient,
  prepareManagedMcpRuntimeLaunch,
  prepareAgentMemoryRun,
  type ManagedMcpRuntimeProxyRegistry,
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

export { assertRuntimeProfileRevisionStillActive };

type RuntimeWorkerService = Pick<
  WorkerApplicationService,
  "issueActivationCredential" | "origin"
> &
  Partial<
    Pick<WorkerApplicationService, "issueActivationCredentialForWorkspace">
  >;

export function createConfiguredRuntime(input: {
  agentMemoryCoordinator?: AgentMemoryCoordinator;
  credentialEnvironment: RuntimeCredentialEnvironmentBinding;
  cwd: string;
  host: AuthenticatedHostContext;
  implementations: RuntimeImplementationRegistry;
  managedMcpProxyRegistry: ManagedMcpRuntimeProxyRegistry;
  probeReport: RuntimeProfileProbeReport;
  resolvedModel?: ResolvedModel;
  toolAccessMode?: ToolAccessMode;
  runtimeProfileRegistry: RuntimeProfileRegistry;
  runtimeProfileRevision: RuntimeProfileRevision;
  supervisorDirectory: string;
  workerService: RuntimeWorkerService;
}): RuntimeAdapter {
  return input.implementations.createRuntime(
    input.runtimeProfileRevision,
    input.probeReport,
    {
      activationEnvironment: async (scope) => {
        const secretLease = await input.credentialEnvironment.resolve();
        const leases = [secretLease];
        try {
          if (scope.agent !== undefined) {
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
          const manifest = input.runtimeProfileRevision.manifest;
          const managedMcpAdapter =
            manifest.manifestVersion === 1
              ? undefined
              : manifest.managedMcpAdapter;
          if (managedMcpAdapter !== undefined) {
            leases.push(
              await prepareManagedMcpRuntimeLaunch({
                adapter: managedMcpAdapter,
                client: new NodeHttpManagedMcpWorkerClient({
                  accessToken: credential.accessToken,
                  origin: input.workerService.origin,
                }),
                existingEnvironment: {
                  ...(manifest.manifestVersion === 1 ? {} : manifest.staticEnv),
                  ...secretLease.env,
                },
                registry: input.managedMcpProxyRegistry,
                temporaryDirectory: join(
                  input.supervisorDirectory,
                  "managed-mcp-runtime",
                ),
              }),
            );
          }
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
}
