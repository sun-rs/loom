import type {
  ManagedComputerOperationEffectInput,
  ManagedComputerOperationEffects,
  ManagedComputerUpgradeEffectInput,
} from "./managed-computer-operation.ts";

export type ComputerServiceReplacementPort = {
  commit(operationId: string): Promise<unknown>;
  prepare(input: {
    expectedBuildVersion: string;
    operationId: string;
  }): Promise<unknown>;
};

export type ManagedComputerServiceOperationEffectsOptions = Readonly<{
  downloadUpgrade(input: ManagedComputerUpgradeEffectInput): Promise<void>;
  drain(input: ManagedComputerOperationEffectInput): Promise<void>;
  replacement: ComputerServiceReplacementPort;
  stageUpgrade(input: ManagedComputerUpgradeEffectInput): Promise<void>;
  verifyUpgrade(input: ManagedComputerUpgradeEffectInput): Promise<void>;
}>;

/**
 * Binds server-owned operation phases to local, typed effects. Replacement is
 * delegated to the whole-service attestation owner; this adapter adds no
 * command, path, URL, log, or retry state of its own.
 */
export function createManagedComputerServiceOperationEffects(
  options: ManagedComputerServiceOperationEffectsOptions,
): ManagedComputerOperationEffects {
  return Object.freeze({
    activateReplacement: async (input) => {
      await options.replacement.commit(input.operationId);
    },
    downloadUpgrade: async (input) => {
      await options.downloadUpgrade(input);
    },
    drain: async (input) => {
      await options.drain(input);
    },
    prepareReplacement: async (input) => {
      await options.replacement.prepare({
        expectedBuildVersion: expectedReplacementBuild(input),
        operationId: input.operationId,
      });
    },
    stageUpgrade: async (input) => {
      await options.stageUpgrade(input);
    },
    verifyUpgrade: async (input) => {
      await options.verifyUpgrade(input);
    },
  });
}

function expectedReplacementBuild(
  input: ManagedComputerOperationEffectInput,
): string {
  if (input.action === "restart") return input.sourceBuildVersion;
  if (input.targetBuildVersion === undefined) {
    throw new Error("upgrade targetBuildVersion is required");
  }
  return input.targetBuildVersion;
}
