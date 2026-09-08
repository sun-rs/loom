import {
  RuntimeProfileRegistryNotFoundError,
  type RuntimeProfileRegistry,
} from "@rah-os/agent-host";
import type { RoomKernel, WorkerProfileMetadataPort } from "@rah-os/kernel";
import type { LocalComputerProfileStore } from "./local-computer-profile-store.ts";
import {
  buildLocalComputerObservation,
  runtimeProfileCliId,
} from "./local-runtime-inventory.ts";

// Only allowlisted presentation facts leave the local Computer/immutable Registry owners.
export function createDaemonWorkerProfileMetadata(input: {
  hostId: string;
  kernel: Pick<RoomKernel, "listHosts">;
  computerProfiles: Pick<LocalComputerProfileStore, "read">;
  registries: ReadonlyMap<string, Pick<RuntimeProfileRegistry, "getRevision">>;
  now?: () => Date;
}): WorkerProfileMetadataPort {
  return {
    computer(hostId) {
      if (hostId !== input.hostId) return undefined;
      const profile = input.computerProfiles.read(hostId);
      const observed = buildLocalComputerObservation({
        hostId,
        kernel: input.kernel,
        ...(profile ? { computerProfile: profile } : {}),
        ...(input.now ? { now: input.now() } : {}),
      });
      return {
        hostId,
        displayName: observed.displayName,
        hostname: observed.hostname,
        os: observed.os,
        description: observed.description ?? null,
        connection: {
          status: observed.status,
          observedAt: observed.observedAt,
          staleAfterMs: observed.staleAfterMs,
          ...(observed.lastSeenAt ? { lastSeenAt: observed.lastSeenAt } : {}),
        },
      };
    },
    runtime(target) {
      if (target.hostId !== input.hostId) return undefined;
      for (const registry of input.registries.values()) {
        let revision;
        try {
          revision = registry.getRevision(target.runtimeProfileRevisionId);
        } catch (error) {
          if (error instanceof RuntimeProfileRegistryNotFoundError) continue;
          throw error;
        }
        if (!revision || revision.runtimeProfileId !== target.runtimeProfileId)
          continue;
        const cliId = runtimeProfileCliId(revision);
        return {
          ...target,
          displayName: revision.manifest.displayName,
          ...(cliId ? { cliId } : {}),
          executionMode: "byoc",
        };
      }
      return undefined;
    },
  };
}
