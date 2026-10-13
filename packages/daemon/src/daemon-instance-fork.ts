import type { CopyInstanceSession } from "../../kernel/src/instance-fork.ts";
import { join } from "node:path";
import {
  ProviderSessionStore,
  type AgentMemoryCoordinator,
  type RuntimeProfileRegistry,
} from "@rah-os/agent-host";
import type { RoomKernel, AuthenticatedHostContext } from "@rah-os/core";
import type { ClientApplicationServiceOptions } from "@rah-os/application-service";
import { ConflictError } from "../../kernel/src/errors.ts";
import {
  nativeSessionCopyAdapter,
  type NativeSessionCopyAdapter,
} from "../../agent-host/src/native-session-copy.ts";
import type { ConfiguredLocalRuntimeSnapshot } from "./local-runtime-inventory.ts";

/** Composition only: Kernel authorizes/CASes membership; Host owns durable native copying. */
type BranchOptions = {
  copyNative?: NativeSessionCopyAdapter["copy"];
  kernel: RoomKernel;
  host: AuthenticatedHostContext;
  stateDirectory: string;
  registries: ReadonlyMap<string, RuntimeProfileRegistry>;
  configured: readonly ConfiguredLocalRuntimeSnapshot[];
  memory: Pick<AgentMemoryCoordinator, "workspaceRoots">;
};
export function createDaemonInstanceFork(
  input: BranchOptions,
): NonNullable<ClientApplicationServiceOptions["instanceFork"]> {
  const copy = createDaemonSessionCopy(input);
  return (actor, request) =>
    input.kernel.roles.forkInstance(actor, input.host, request, copy);
}
export function createDaemonSide(
  input: BranchOptions,
): NonNullable<ClientApplicationServiceOptions["sideCreate"]> {
  const copy = createDaemonSessionCopy(input);
  return (actor, request) =>
    input.kernel.roles.createSide(actor, input.host, request, copy);
}
function createDaemonSessionCopy(input: BranchOptions): CopyInstanceSession {
  const store = new ProviderSessionStore({
    rootDirectory: join(
      input.stateDirectory,
      "supervisors",
      "provider-sessions",
    ),
  });
  return async (plan) => {
    const runtime = input.configured.find(
      (r) => r.runtimeProfileRevisionId === plan.runtimeProfileRevisionId,
    );
    if (plan.hostId !== input.host.hostId || !runtime?.available)
      throw new ConflictError(
        "Session copying requires an available local runtime",
      );
    const placement = plan.nativePlacement;
    if (
      !placement ||
      placement.hostId !== input.host.hostId ||
      placement.runtimeProfileRevisionId !== plan.runtimeProfileRevisionId
    )
      throw new ConflictError(
        "Fork requires an established session on the current local runtime revision",
      );
    if (plan.configuration.executionWorkspace?.kind !== "channel_home")
      throw new ConflictError(
        "Fork currently requires a shared Channel home; legacy private cwd is unsupported",
      );
    const registry = [...input.registries.values()].find((r) =>
      r
        .listProfiles()
        .some(
          (p) =>
            p.runtimeProfileId === plan.runtimeProfileId &&
            p.activeRevisionId === plan.runtimeProfileRevisionId,
        ),
    );
    const revision = registry?.getActiveRevision(plan.runtimeProfileId);
    if (!revision)
      throw new ConflictError("Fork runtime profile is no longer active");
    const manifest = revision.manifest;
    const adapter = nativeSessionCopyAdapter(manifest.adapter.kind);
    if (!adapter)
      throw new ConflictError(
        "This runtime has no native session-copy adapter",
      );
    if (manifest.manifestVersion === 1 || manifest.credentialSlots.length)
      throw new ConflictError(
        "Fork cannot resolve this runtime credential environment safely",
      );
    const cwd = (
      await input.memory.workspaceRoots(plan.sourceInstanceId)
    ).roots.find(
      (r) => r.rootId === "runtime-project" && r.state === "ready",
    )?.rootPath;
    if (!cwd) throw new ConflictError("Fork Channel home is unavailable");
    const source = {
      participantId: plan.sourceInstanceId,
      provider: adapter.provider,
      runtimeProfileRevisionId: placement.runtimeProfileRevisionId,
      workspaceMountRevisionId: placement.workspaceMountRevisionId,
    };
    await store.forkInstance(
      {
        operationId: `${plan.operationId}:${plan.fingerprint}`,
        source,
        sourceGeneration: plan.sourceGeneration,
        target: { ...source, participantId: plan.targetInstanceId },
      },
      (binding) =>
        (input.copyNative ?? adapter.copy)({
          executable: runtime.resolvedExecutablePath ?? runtime.executable,
          env: { ...process.env, ...manifest.staticEnv },
          cwd,
          sourceId: binding.providerSessionId,
          supervisorDirectory: join(input.stateDirectory, "supervisors"),
        }),
    );
  };
}
