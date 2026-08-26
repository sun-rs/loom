import {
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
  RuntimeProfileRegistryNotFoundError,
  type RuntimeAdapter,
} from "@rah-os/agent-host";
import type {
  RuntimeRecoveryDescriptor,
  RuntimeProfileRevision,
} from "@rah-os/protocol";

type RegistryRuntimeRecovery = {
  driverIds: readonly string[];
  resolve(descriptor: RuntimeRecoveryDescriptor): RuntimeAdapter;
};

export function createRegistryBackedRuntimeRecovery(input: {
  cwd: string;
  implementations: RuntimeImplementationRegistry;
  registry: RuntimeProfileRegistry;
  supervisorDirectory: string;
}): RegistryRuntimeRecovery {
  return {
    driverIds: input.implementations.recoveryDrivers(),
    resolve: (descriptor) => {
      requireImmutableRecoveryProvenance(descriptor);
      const recoveryRevision = input.registry.getRevision(
        descriptor.runtimeProfileRevisionId,
      );
      return createRecoveryRuntime(input, descriptor, recoveryRevision);
    },
  };
}

export function createRegistryBackedRuntimeRecoveryFromRegistries(input: {
  cwd: string;
  implementations: RuntimeImplementationRegistry;
  registries: RuntimeProfileRegistry[];
  supervisorDirectory: string;
}): RegistryRuntimeRecovery {
  return {
    driverIds: input.implementations.recoveryDrivers(),
    resolve: (descriptor) => {
      requireImmutableRecoveryProvenance(descriptor);
      const matches: RuntimeProfileRevision[] = [];
      for (const registry of input.registries) {
        try {
          matches.push(
            registry.getRevision(descriptor.runtimeProfileRevisionId),
          );
        } catch (error) {
          if (error instanceof RuntimeProfileRegistryNotFoundError) continue;
          throw error;
        }
      }
      if (matches.length === 0) {
        throw new Error(
          `runtime recovery profile revision is not configured: ${descriptor.runtimeProfileRevisionId}`,
        );
      }
      if (matches.length > 1) {
        throw new Error(
          `runtime recovery profile revision is ambiguous: ${descriptor.runtimeProfileRevisionId}`,
        );
      }
      return createRecoveryRuntime(input, descriptor, matches[0]!);
    },
  };
}

function requireImmutableRecoveryProvenance(
  descriptor: RuntimeRecoveryDescriptor,
): asserts descriptor is RuntimeRecoveryDescriptor & {
  recoveryImplementationVersion: string;
  runtimeProfileDigest: string;
  runtimeProfileRevisionId: string;
} {
  if (
    descriptor.runtimeProfileRevisionId === undefined ||
    descriptor.runtimeProfileDigest === undefined ||
    descriptor.recoveryImplementationVersion === undefined
  ) {
    throw new Error(
      "registry-backed runtime recovery descriptor lacks immutable profile provenance",
    );
  }
}

function createRecoveryRuntime(
  input: {
    cwd: string;
    implementations: RuntimeImplementationRegistry;
    supervisorDirectory: string;
  },
  descriptor: RuntimeRecoveryDescriptor & {
    recoveryImplementationVersion: string;
    runtimeProfileDigest: string;
    runtimeProfileRevisionId: string;
  },
  revision: RuntimeProfileRevision,
): RuntimeAdapter {
  if (revision.contentDigest !== descriptor.runtimeProfileDigest) {
    throw new Error(
      `runtime recovery profile digest mismatch: ${descriptor.runtimeProfileRevisionId}`,
    );
  }
  const installedRecoveryVersion =
    input.implementations.recoveryDriverImplementationVersion(
      descriptor.driver,
    );
  if (installedRecoveryVersion !== descriptor.recoveryImplementationVersion) {
    throw new Error(
      `runtime recovery implementation version mismatch: ${descriptor.driver}`,
    );
  }
  return input.implementations.createRecoveryRuntime(
    revision,
    descriptor.driver,
    {
      cwd: input.cwd,
      supervisorDirectory: input.supervisorDirectory,
    },
  );
}
