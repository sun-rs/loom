import assert from "node:assert/strict";
import test from "node:test";

import {
  createManagedComputerServiceOperationEffects,
  type ComputerServiceReplacementPort,
} from "../src/index.ts";

test("managed Computer effects bind restart and upgrade to the proven replacement coordinator", async () => {
  const events: string[] = [];
  const replacement: ComputerServiceReplacementPort = {
    commit: async (operationId) => {
      events.push(`commit:${operationId}`);
    },
    prepare: async ({ expectedBuildVersion, operationId }) => {
      events.push(`prepare:${operationId}:${expectedBuildVersion}`);
    },
  };
  const effects = createManagedComputerServiceOperationEffects({
    downloadUpgrade: async ({ operationId, targetBuildVersion }) => {
      events.push(`download:${operationId}:${targetBuildVersion}`);
    },
    drain: async ({ operationId }) => {
      events.push(`drain:${operationId}`);
    },
    replacement,
    stageUpgrade: async ({ operationId, targetBuildVersion }) => {
      events.push(`stage:${operationId}:${targetBuildVersion}`);
    },
    verifyUpgrade: async ({ operationId, targetBuildVersion }) => {
      events.push(`verify:${operationId}:${targetBuildVersion}`);
    },
  });

  await effects.drain({
    action: "restart",
    operationId: "restart-operation",
    sourceBuildVersion: "computer/1.0.0",
  });
  await effects.prepareReplacement({
    action: "restart",
    operationId: "restart-operation",
    sourceBuildVersion: "computer/1.0.0",
  });
  await effects.activateReplacement({
    action: "restart",
    operationId: "restart-operation",
    sourceBuildVersion: "computer/1.0.0",
  });
  const upgrade = {
    action: "upgrade" as const,
    operationId: "upgrade-operation",
    sourceBuildVersion: "computer/1.0.0",
    targetBuildVersion: "computer/2.0.0",
  };
  await effects.downloadUpgrade(upgrade);
  await effects.verifyUpgrade(upgrade);
  await effects.stageUpgrade(upgrade);
  await effects.prepareReplacement(upgrade);
  await effects.activateReplacement(upgrade);

  assert.deepEqual(events, [
    "drain:restart-operation",
    "prepare:restart-operation:computer/1.0.0",
    "commit:restart-operation",
    "download:upgrade-operation:computer/2.0.0",
    "verify:upgrade-operation:computer/2.0.0",
    "stage:upgrade-operation:computer/2.0.0",
    "prepare:upgrade-operation:computer/2.0.0",
    "commit:upgrade-operation",
  ]);
});

test("upgrade replacement refuses an absent target build before local effects", async () => {
  let prepared = false;
  const effects = createManagedComputerServiceOperationEffects({
    downloadUpgrade: async () => undefined,
    drain: async () => undefined,
    replacement: {
      commit: async () => undefined,
      prepare: async () => {
        prepared = true;
      },
    },
    stageUpgrade: async () => undefined,
    verifyUpgrade: async () => undefined,
  });

  await assert.rejects(
    effects.prepareReplacement({
      action: "upgrade",
      operationId: "malformed-upgrade",
      sourceBuildVersion: "computer/1.0.0",
    }),
    /targetBuildVersion/u,
  );
  assert.equal(prepared, false);
});
