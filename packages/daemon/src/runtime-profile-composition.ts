import {
  RuntimeCredentialEnvironmentBinding,
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
  type RuntimeAdapter,
} from "@rah-os/agent-host";
import type { WorkerApplicationService } from "@rah-os/application-service";
import type { AuthenticatedHostContext } from "@rah-os/core";
import type {
  ResolvedModel,
  RuntimeProfileProbeReport,
  RuntimeProfileRevision,
} from "@rah-os/protocol";

export function assertRuntimeProfileRevisionStillActive(
  registry: RuntimeProfileRegistry,
  expectedRevision: RuntimeProfileRevision,
): void {
  const current = registry.getActiveRevision(expectedRevision.runtimeProfileId);
  if (
    current === null ||
    current.state !== "active" ||
    current.runtimeProfileRevisionId !==
      expectedRevision.runtimeProfileRevisionId ||
    current.contentDigest !== expectedRevision.contentDigest
  ) {
    throw new Error(
      `RuntimeProfile ${expectedRevision.runtimeProfileId} active revision changed; restart the daemon to select the new revision`,
    );
  }
}

export function createConfiguredRuntime(input: {
  credentialEnvironment: RuntimeCredentialEnvironmentBinding;
  cwd: string;
  host: AuthenticatedHostContext;
  implementations: RuntimeImplementationRegistry;
  probeReport: RuntimeProfileProbeReport;
  resolvedModel?: ResolvedModel;
  runtimeProfileRegistry: RuntimeProfileRegistry;
  runtimeProfileRevision: RuntimeProfileRevision;
  supervisorDirectory: string;
  workerService: WorkerApplicationService;
}): RuntimeAdapter {
  return input.implementations.createRuntime(
    input.runtimeProfileRevision,
    input.probeReport,
    {
      activationEnvironment: async (scope) => {
        const secretLease = await input.credentialEnvironment.resolve();
        const credential = input.workerService.issueActivationCredential(
          input.host,
          scope,
        );
        return {
          env: {
            ...secretLease.env,
            RAH_WORKER_API_URL: input.workerService.origin,
            RAH_WORKER_TOKEN: credential.accessToken,
          },
          redactions: [
            ...(secretLease.redactions ?? []),
            credential.accessToken,
          ],
          release: () => {
            credential.revoke();
            secretLease.release?.();
          },
        };
      },
      beforeStart: () =>
        assertRuntimeProfileRevisionStillActive(
          input.runtimeProfileRegistry,
          input.runtimeProfileRevision,
        ),
      cwd: input.cwd,
      supervisorDirectory: input.supervisorDirectory,
    },
    input.resolvedModel,
  );
}
