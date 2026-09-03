import assert from "node:assert/strict";
import test from "node:test";

import type {
  RuntimeProfileManifestV3,
  RuntimeProfileProbeReport,
} from "@rah-os/protocol";
import {
  computeRuntimeProfileManifestDigest,
  computeRuntimeProfileProbeDigest,
} from "@rah-os/agent-host";

import { RuntimeOfferPublisher } from "../src/runtime-offer-publisher.ts";

const executableIdentity = {
  byteLength: 100,
  contentDigest: `sha256:${"1".repeat(64)}`,
  requestedExecutable: "codex",
  resolvedExecutablePath: "/usr/local/bin/codex",
};
const runtimeManifest = {
  adapter: {
    config: {},
    executable: "codex",
    fixedArgs: [],
    kind: "generic-process/v1" as const,
  },
  credentialSlots: [],
  declaredCapabilities: [],
  displayName: "Codex",
  manifestVersion: 3 as const,
  modelCatalogProbe: { kind: "codex-cli/v1" as const },
  protocolFamily: "rah-worker-process/v1" as const,
  recoveryDrivers: [],
  runtimeProfileId: "profile-1",
  staticEnv: {},
  workspacePolicy: { allowedModes: ["in_place" as const] },
} satisfies RuntimeProfileManifestV3;
const runtimeProfileDigest =
  computeRuntimeProfileManifestDigest(runtimeManifest);

test("a lease refresh checks availability without replacing the frozen catalog snapshot", async () => {
  const published: Array<{
    modelBindingDescriptors: Array<{ supportedReasoning: string[] }>;
    state: string;
  }> = [];
  const initial = probeReport("low");
  const controller = new AbortController();
  let availabilityChecks = 0;
  const publisher = new RuntimeOfferPublisher({
    host: {
      hostId: "host-1",
      instanceId: "host-instance-1",
    } as never,
    kernel: {
      publishRuntimeOffer: (
        _actor: unknown,
        offer: {
          modelBindingDescriptors: Array<{ supportedReasoning: string[] }>;
          state: string;
        },
      ) => {
        published.push(offer);
      },
    } as never,
    leaseMs: 1_000,
    maxConcurrent: 1,
    probeReport: initial,
    refreshIntervalMs: 1,
    refreshAvailability: async () => {
      availabilityChecks += 1;
      controller.abort();
      return true;
    },
    revisionIsActive: () => true,
    runtimeOfferId: "offer-1",
    runtimeProfileRevision: {
      activatedAt: "2026-08-28T00:00:00.000Z",
      contentDigest: runtimeProfileDigest,
      importedAt: "2026-08-28T00:00:00.000Z",
      manifest: runtimeManifest,
      revision: 1,
      runtimeProfileId: "profile-1",
      runtimeProfileRevisionId: "profile-revision-1",
      state: "active",
    },
  });

  assert.equal(publisher.publishAvailable(), true);
  await publisher.run(controller.signal);
  assert.deepEqual(
    published.map(({ state }) => state),
    ["available", "available", "unavailable"],
  );
  assert.deepEqual(
    published
      .slice(0, 2)
      .map(({ modelBindingDescriptors }) =>
        modelBindingDescriptors.map(({ supportedReasoning }) =>
          supportedReasoning.join(","),
        ),
      ),
    [["low"], ["low"]],
  );
  assert.equal(availabilityChecks, 1);
});

test("a failed lightweight availability check withdraws the offer without replacing probe evidence", async () => {
  const published: string[] = [];
  const controller = new AbortController();
  const publisher = new RuntimeOfferPublisher({
    host: {
      hostId: "host-1",
      instanceId: "host-instance-1",
    } as never,
    kernel: {
      publishRuntimeOffer: (_actor: unknown, offer: { state: string }) => {
        published.push(offer.state);
      },
    } as never,
    leaseMs: 1_000,
    maxConcurrent: 1,
    probeReport: probeReport("low"),
    refreshIntervalMs: 1,
    refreshAvailability: async () => {
      controller.abort();
      return false;
    },
    revisionIsActive: () => true,
    runtimeOfferId: "offer-1",
    runtimeProfileRevision: {
      activatedAt: "2026-08-28T00:00:00.000Z",
      contentDigest: runtimeProfileDigest,
      importedAt: "2026-08-28T00:00:00.000Z",
      manifest: runtimeManifest,
      revision: 1,
      runtimeProfileId: "profile-1",
      runtimeProfileRevisionId: "profile-revision-1",
      state: "active",
    },
  });

  assert.equal(publisher.publishAvailable(), true);
  await publisher.run(controller.signal);
  assert.deepEqual(published, ["available", "unavailable", "unavailable"]);
});

function probeReport(reasoning: string): RuntimeProfileProbeReport {
  const reportWithoutDigest = {
    adapter: {
      implementationVersion: "test",
      kind: "generic-process/v1",
    },
    available: true,
    executableIdentity,
    modelBindings: [
      {
        adapterMapping: {
          config: {
            modelArguments: ["--model", "{modelId}"],
            reasoningArguments: [
              "--config",
              "model_reasoning_effort={reasoning}",
            ],
          },
          kind: "generic-process-argv/v1",
        },
        capabilityClasses: ["deep_coding" as const],
        evidence: "probed" as const,
        modelBindingId: "binding-1",
        modelId: "gpt-5.6-sol",
        provider: "openai",
        reasoningOptions: [{ label: reasoning, value: reasoning }],
        supportedReasoning: [reasoning],
        supportedServiceTiers: ["default" as const],
      },
    ],
    observedAt: "2026-08-28T00:00:00.000Z",
    probeReportId: `probe-${reasoning}`,
    recoveryDrivers: [],
    reportVersion: 2 as const,
    runtimeProfileDigest,
    runtimeProfileId: "profile-1",
    runtimeProfileRevisionId: "profile-revision-1",
  } satisfies Omit<
    Extract<RuntimeProfileProbeReport, { reportVersion: 2 }>,
    "probeDigest"
  >;
  return {
    ...reportWithoutDigest,
    probeDigest: computeRuntimeProfileProbeDigest(reportWithoutDigest),
  };
}
