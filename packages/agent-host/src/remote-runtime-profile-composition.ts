import type {
  PlacementDecision,
  ResolvedModel,
  RuntimeOffer,
  RuntimeProfileProbeReport,
  RuntimeProfileRevision,
  ToolAccessMode,
  WorkspaceMountDescriptor,
} from "@rah-os/protocol";
import { join } from "node:path";

import {
  buildRuntimeOfferFromProfile,
  RuntimeCredentialEnvironmentBinding,
  RuntimeImplementationRegistry,
} from "./runtime-implementation-registry.ts";
import { AgentMemoryCoordinator } from "./agent-memory-coordinator.ts";
import { prepareAgentMemoryRun } from "./agent-memory-activation.ts";
import { combineActivationEnvironmentLeases } from "./activation-environment-lease.ts";

import { ProviderSessionStore } from "./provider-session-store.ts";
import { RuntimeProfileRegistry } from "./runtime-profile-registry.ts";
import { createRegistryBackedRuntimeRecoveryFromRegistries } from "./runtime-profile-recovery.ts";
import type { RuntimeAdapter } from "./runtime.ts";
import {
  issueRemoteWorkerActivationEnvironment,
  type RemoteWorkerCredentialServicePort,
} from "./remote-worker-activation-environment.ts";

export type RemoteRuntimeProfileSetEntry = Readonly<{
  credentialEnvironment: RuntimeCredentialEnvironmentBinding;
  cwd: string;
  leaseMs: number;
  maxConcurrent: number;
  probeReport: RuntimeProfileProbeReport;
  runtimeOfferId: string;
  runtimeProfileRegistry: RuntimeProfileRegistry;
  runtimeProfileRevision: RuntimeProfileRevision;
  workspaceMountDescriptors: readonly WorkspaceMountDescriptor[];
}>;

export type RemoteRuntimeProfileBinding = Readonly<{
  placementRuntimeResolver(placement: PlacementDecision): RuntimeAdapter;
  runtime: RuntimeAdapter;
  runtimeRecoveryDrivers: readonly string[];
  runtimeRecoveryResolver: (
    descriptor: import("@rah-os/protocol").RuntimeRecoveryDescriptor,
  ) => RuntimeAdapter;
}>;

/**
 * Frozen startup selection of one or more active RuntimeProfile revisions for
 * a Computer service. It creates attachment-specific Worker bindings without
 * duplicating profile, Offer, model-selection, or recovery rules.
 */
export class RemoteRuntimeProfileSet {
  readonly #memoryCoordinator: AgentMemoryCoordinator;
  readonly #implementations: RuntimeImplementationRegistry;
  #lastObservedAtMs = 0;
  readonly #nowMs: () => number;

  readonly #profiles: readonly RemoteRuntimeProfileSetEntry[];
  readonly #supervisorDirectory: string;

  constructor(input: {
    implementations: RuntimeImplementationRegistry;

    nowMs?: () => number;
    profiles: readonly RemoteRuntimeProfileSetEntry[];
    supervisorDirectory: string;
  }) {
    if (input.profiles.length === 0 || input.profiles.length > 128) {
      throw new Error("Remote RuntimeProfile set requires 1 to 128 profiles");
    }
    const offerIds = new Set<string>();
    for (const profile of input.profiles) {
      positiveInteger(profile.leaseMs, "leaseMs");
      positiveInteger(profile.maxConcurrent, "maxConcurrent");
      if (offerIds.has(profile.runtimeOfferId)) {
        throw new Error(`duplicate runtimeOfferId: ${profile.runtimeOfferId}`);
      }
      offerIds.add(profile.runtimeOfferId);
      assertRuntimeProfileRevisionStillActive(
        profile.runtimeProfileRegistry,
        profile.runtimeProfileRevision,
      );
    }
    this.#implementations = input.implementations;
    this.#memoryCoordinator = new AgentMemoryCoordinator({
      rootDirectory: join(input.supervisorDirectory, "agent-memory"),
      // Remote Computers retain the typed hint for the next canonical
      // Activation until a host-local maintenance lane can be fenced.
      wake: () => false,
    });

    this.#nowMs = input.nowMs ?? Date.now;
    this.#profiles = Object.freeze([...input.profiles]);
    this.#supervisorDirectory = input.supervisorDirectory;
  }

  runtimeOffers(identity: {
    hostId: string;
    hostInstanceId: string;
  }): readonly RuntimeOffer[] {
    return this.#profiles.map((profile) => {
      const observedAtMs = Math.max(this.#time(), this.#lastObservedAtMs + 1);
      this.#lastObservedAtMs = observedAtMs;
      return buildRuntimeOfferFromProfile({
        hostId: identity.hostId,
        hostInstanceId: identity.hostInstanceId,
        leaseUntil: new Date(observedAtMs + profile.leaseMs).toISOString(),
        maxConcurrent: profile.maxConcurrent,
        observedAt: new Date(observedAtMs).toISOString(),
        probeReport: profile.probeReport,
        runtimeOfferId: profile.runtimeOfferId,
        runtimeProfileRevision: profile.runtimeProfileRevision,
        state: revisionIsActive(profile) ? "available" : "unavailable",
        workspaceMountDescriptors: [...profile.workspaceMountDescriptors],
      });
    });
  }

  createRuntimeBinding(
    resident: RemoteWorkerCredentialServicePort,
  ): RemoteRuntimeProfileBinding {
    const byOfferId = new Map(
      this.#profiles.map((profile) => [profile.runtimeOfferId, profile]),
    );
    const createRuntime = (
      profile: RemoteRuntimeProfileSetEntry,
      resolvedModel?: ResolvedModel,
      toolAccessMode?: ToolAccessMode,
    ) =>
      createRemoteConfiguredRuntime({
        agentMemoryCoordinator: this.#memoryCoordinator,
        credentialEnvironment: profile.credentialEnvironment,
        cwd: profile.cwd,
        implementations: this.#implementations,
        probeReport: profile.probeReport,
        resident,
        ...(resolvedModel === undefined ? {} : { resolvedModel }),
        ...(toolAccessMode === undefined ? {} : { toolAccessMode }),
        runtimeProfileRegistry: profile.runtimeProfileRegistry,
        runtimeProfileRevision: profile.runtimeProfileRevision,
        supervisorDirectory: this.#supervisorDirectory,
      });
    const recovery = createRegistryBackedRuntimeRecoveryFromRegistries({
      cwd: requireSharedCwd(this.#profiles),
      implementations: this.#implementations,
      registries: distinctRegistries(this.#profiles),
      supervisorDirectory: this.#supervisorDirectory,
    });
    return Object.freeze({
      placementRuntimeResolver: (placement: PlacementDecision) => {
        const profile = byOfferId.get(placement.runtimeOfferId);
        if (profile === undefined) {
          throw new Error(
            `Placement references unconfigured RuntimeOffer ${placement.runtimeOfferId}`,
          );
        }
        return createRuntime(
          profile,
          placement.resolvedModel,
          placement.toolAccessMode,
        );
      },
      runtime: createRuntime(this.#profiles[0]!),
      runtimeRecoveryDrivers: recovery.driverIds,
      runtimeRecoveryResolver: recovery.resolve,
    });
  }

  async close(): Promise<void> {
    await this.#memoryCoordinator.close();
  }

  #time(): number {
    const value = this.#nowMs();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(
        "Remote RuntimeProfile clock must return epoch milliseconds",
      );
    }
    return value;
  }
}

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
      `RuntimeProfile ${expectedRevision.runtimeProfileId} active revision changed; restart the service to select the new revision`,
    );
  }
}

/**
 * Creates an immutable RuntimeProfile execution whose Worker lease comes from
 * the authenticated Remote Computer session. Long-lived attachment and
 * Computer session credentials never enter the child environment.
 */
export function createRemoteConfiguredRuntime(input: {
  agentMemoryCoordinator?: AgentMemoryCoordinator;
  credentialEnvironment: RuntimeCredentialEnvironmentBinding;
  cwd: string;
  implementations: RuntimeImplementationRegistry;

  probeReport: RuntimeProfileProbeReport;
  resident: RemoteWorkerCredentialServicePort;
  resolvedModel?: ResolvedModel;
  toolAccessMode?: ToolAccessMode;
  runtimeProfileRegistry: RuntimeProfileRegistry;
  runtimeProfileRevision: RuntimeProfileRevision;
  supervisorDirectory: string;
}): RuntimeAdapter {
  const workerEnvironmentOptions = {
    credentialDirectory: join(input.supervisorDirectory, "worker-credentials"),
  };
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
          const worker = await issueRemoteWorkerActivationEnvironment(
            input.resident,
            workerEnvironmentOptions,
            scope,
          );
          leases.push(worker.lease);
          return combineActivationEnvironmentLeases(
            leases,
            "remote Runtime activation environment release failed",
          );
        } catch (error) {
          try {
            await combineActivationEnvironmentLeases(
              leases,
              "remote Runtime activation setup cleanup failed",
            ).release?.();
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              "remote Runtime activation setup and cleanup failed",
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

function revisionIsActive(profile: RemoteRuntimeProfileSetEntry): boolean {
  try {
    assertRuntimeProfileRevisionStillActive(
      profile.runtimeProfileRegistry,
      profile.runtimeProfileRevision,
    );
    return profile.probeReport.available;
  } catch {
    return false;
  }
}

function distinctRegistries(
  profiles: readonly RemoteRuntimeProfileSetEntry[],
): RuntimeProfileRegistry[] {
  return [
    ...new Set(profiles.map((profile) => profile.runtimeProfileRegistry)),
  ];
}

function requireSharedCwd(
  profiles: readonly RemoteRuntimeProfileSetEntry[],
): string {
  const cwd = profiles[0]!.cwd;
  if (profiles.some((profile) => profile.cwd !== cwd)) {
    throw new Error(
      "Remote RuntimeProfile recovery requires one shared workspace cwd",
    );
  }
  return cwd;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}
