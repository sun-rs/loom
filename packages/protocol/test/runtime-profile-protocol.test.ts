import assert from "node:assert/strict";
import test from "node:test";

import {
  RuntimeOfferSchema,
  RuntimeProfileManifestV1Schema,
  RuntimeProfileManifestV2Schema,
  RuntimeProfileManifestV3Schema,
  RuntimeProfileProbeReportSchema,
  RuntimeProfileProbeReportV2Schema,
} from "../src/index.ts";

const manifest = {
  adapter: {
    config: {
      diagnosticByteLimit: 262_144,
      terminationGraceMs: 5_000,
    },
    executable: "codex",
    fixedArgs: ["exec", "--ephemeral"],
    kind: "generic-process/v1",
  },
  declaredCapabilities: ["worker_commands", "session_resume"],
  displayName: "Codex main",
  manifestVersion: 1,
  protocolFamily: "rah-worker-process/v1",
  recoveryDrivers: ["rah-process-supervisor-v1"],
  runtimeProfileId: "codex-main",
  workspacePolicy: {
    allowedModes: ["in_place", "worktree"],
  },
} as const;

test("RuntimeProfileManifestV1 is strict and shell-free", () => {
  const parsed = RuntimeProfileManifestV1Schema.parse(manifest);
  assert.equal(parsed.manifestVersion, 1);
  assert.equal(parsed.adapter.executable, "codex");

  assert.throws(() =>
    RuntimeProfileManifestV1Schema.parse({
      ...manifest,
      staticEnv: { PROVIDER_API_KEY: "must-not-enter-r2a" },
    }),
  );
  assert.throws(() =>
    RuntimeProfileManifestV1Schema.parse({
      ...manifest,
      adapter: {
        ...manifest.adapter,
        config: {
          ...manifest.adapter.config,
          unknownOption: true,
        },
      },
    }),
  );
  assert.throws(() =>
    RuntimeProfileManifestV1Schema.parse({
      ...manifest,
      adapter: {
        ...manifest.adapter,
        executable: "codex && arbitrary-shell-command",
      },
    }),
  );
  assert.throws(() =>
    RuntimeProfileManifestV1Schema.parse({
      ...manifest,
      declaredCapabilities: ["worker_commands", "worker_commands"],
    }),
  );
  assert.throws(() =>
    RuntimeProfileManifestV1Schema.parse({
      ...manifest,
      protocolFamily: "unknown-runtime/v1",
    }),
  );
  assert.throws(() =>
    RuntimeProfileManifestV1Schema.parse({
      ...manifest,
      adapter: {
        ...manifest.adapter,
        fixedArgs: ["exec", "--api-key=must-not-enter-a-manifest"],
      },
    }),
  );
});

test("RuntimeProfileManifestV2 names secret slots without accepting secret values", () => {
  const parsed = RuntimeProfileManifestV2Schema.parse({
    ...manifest,
    credentialSlots: [
      {
        slotId: "provider-token",
        target: { kind: "environment", variable: "PROVIDER_TOKEN" },
      },
    ],
    manifestVersion: 2,
    staticEnv: { PROVIDER_MODE: "plan" },
  });
  assert.equal(parsed.credentialSlots[0]?.slotId, "provider-token");

  assert.throws(() =>
    RuntimeProfileManifestV2Schema.parse({
      ...parsed,
      credentialSlots: [
        {
          slotId: "provider-token",
          target: { kind: "environment", variable: "PROVIDER_TOKEN" },
          value: "must-never-enter-a-profile",
        },
      ],
    }),
  );
  assert.throws(() =>
    RuntimeProfileManifestV2Schema.parse({
      ...parsed,
      staticEnv: { RAH_WORKER_TOKEN: "must-not-shadow-daemon-authority" },
    }),
  );
  assert.throws(() =>
    RuntimeProfileManifestV2Schema.parse({
      ...parsed,
      staticEnv: { OPENAI_API_KEY: "must-use-a-credential-slot" },
    }),
  );
  assert.throws(() =>
    RuntimeProfileManifestV2Schema.parse({
      ...parsed,
      credentialSlots: [
        {
          slotId: "first-token",
          target: { kind: "environment", variable: "PROVIDER_TOKEN" },
        },
        {
          slotId: "second-token",
          target: { kind: "environment", variable: "PROVIDER_TOKEN" },
        },
      ],
    }),
  );
});

test("RuntimeProfileManifestV3 names a built-in model catalog probe", () => {
  const parsed = RuntimeProfileManifestV3Schema.parse({
    ...manifest,
    credentialSlots: [],
    manifestVersion: 3,
    modelCatalogProbe: { kind: "codex-cli/v1" },
    staticEnv: {},
  });
  assert.equal(parsed.modelCatalogProbe.kind, "codex-cli/v1");
  const claudeStreamJson = RuntimeProfileManifestV3Schema.parse({
    ...parsed,
    adapter: {
      ...parsed.adapter,
      executable: "claude",
      fixedArgs: ["room-worker-prompt"],
      kind: "claude-stream-json/v1",
    },
    modelCatalogProbe: { kind: "claude-cli/v1" },
    runtimeProfileId: "claude-stream-json-main",
  });
  assert.equal(claudeStreamJson.adapter.kind, "claude-stream-json/v1");
  assert.throws(() =>
    RuntimeProfileManifestV3Schema.parse({
      ...claudeStreamJson,
      modelCatalogProbe: { kind: "codex-cli/v1" },
    }),
  );
  const kimiAcp = RuntimeProfileManifestV3Schema.parse({
    ...parsed,
    adapter: {
      ...parsed.adapter,
      executable: "kimi",
      fixedArgs: ["room-worker-prompt"],
      kind: "kimi-acp/v1",
    },
    modelCatalogProbe: { kind: "kimi-cli/v1" },
    runtimeProfileId: "kimi-acp-main",
  });
  assert.equal(kimiAcp.adapter.kind, "kimi-acp/v1");
  const codexAppServer = RuntimeProfileManifestV3Schema.parse({
    ...parsed,
    adapter: {
      ...parsed.adapter,
      fixedArgs: ["room-worker-prompt"],
      kind: "codex-app-server/v1",
    },
    runtimeProfileId: "codex-app-server-main",
  });
  assert.equal(codexAppServer.adapter.kind, "codex-app-server/v1");
  assert.throws(() =>
    RuntimeProfileManifestV3Schema.parse({
      ...codexAppServer,
      modelCatalogProbe: { kind: "kimi-cli/v1" },
    }),
  );
  const openCodeServer = RuntimeProfileManifestV3Schema.parse({
    ...parsed,
    adapter: {
      ...parsed.adapter,
      executable: "opencode",
      fixedArgs: ["room-worker-prompt"],
      kind: "opencode-server/v1",
    },
    modelCatalogProbe: { kind: "opencode-cli/v1" },
    runtimeProfileId: "opencode-server-main",
  });
  assert.equal(openCodeServer.adapter.kind, "opencode-server/v1");
  assert.throws(() =>
    RuntimeProfileManifestV3Schema.parse({
      ...openCodeServer,
      modelCatalogProbe: { kind: "codex-cli/v1" },
    }),
  );
  assert.equal(
    RuntimeProfileManifestV3Schema.parse({
      ...parsed,
      modelCatalogProbe: { kind: "claude-cli/v1" },
    }).modelCatalogProbe.kind,
    "claude-cli/v1",
  );
  assert.throws(() =>
    RuntimeProfileManifestV3Schema.parse({
      ...parsed,
      modelCatalogProbe: {
        args: ["arbitrary-command"],
        kind: "codex-cli/v1",
      },
    }),
  );
  assert.throws(() =>
    RuntimeProfileManifestV3Schema.parse({
      ...parsed,
      modelCatalogProbe: { kind: "unknown-cli/v1" },
    }),
  );
});

test("probe reports are strict and probed offers must reference immutable evidence", () => {
  const report = RuntimeProfileProbeReportV2Schema.parse({
    adapter: {
      implementationVersion: "generic-process-adapter/v1",
      kind: "generic-process/v1",
    },
    available: true,
    executableIdentity: {
      byteLength: 42,
      contentDigest: `sha256:${"1".repeat(64)}`,
      requestedExecutable: "/usr/bin/fake",
      resolvedExecutablePath: "/usr/bin/fake",
    },
    observedAt: "2026-08-26T00:00:00.000Z",
    probeDigest: `sha256:${"2".repeat(64)}`,
    probeReportId: "probe-report-1",
    recoveryDrivers: [
      {
        driver: "rah-process-supervisor-v1",
        implementationVersion: "rah-process-supervisor/v1",
      },
    ],
    modelBindings: [
      {
        adapterMapping: {
          config: {
            modelArguments: ["--model", "{modelId}"],
            reasoningArguments: ["--effort", "{reasoning}"],
          },
          kind: "generic-process-argv/v1",
        },
        capabilityClasses: ["deep_coding"],
        evidence: "probed",
        defaultReasoning: "low",
        displayName: "GPT-5.6 Sol",
        modelBindingId: "codex:gpt-5.6-luna",
        modelId: "gpt-5.6-luna",
        provider: "openai",
        reasoningOptions: [
          { label: "Low", value: "low" },
          { label: "Extra high", value: "xhigh" },
          { label: "Ultra", value: "ultra" },
        ],
        supportedReasoning: ["low", "xhigh", "ultra"],
        supportedServiceTiers: ["default", "priority"],
      },
    ],
    reportVersion: 2,
    runtimeProfileDigest: `sha256:${"3".repeat(64)}`,
    runtimeProfileId: "codex-main",
    runtimeProfileRevisionId: "codex-main-revision-1",
  });
  assert.equal(report.available, true);
  assert.equal(report.modelBindings[0]?.modelId, "gpt-5.6-luna");
  assert.equal(report.modelBindings[0]?.defaultReasoning, "low");
  assert.deepEqual(report.modelBindings[0]?.supportedReasoning, [
    "low",
    "xhigh",
    "ultra",
  ]);
  assert.throws(() =>
    RuntimeProfileProbeReportV2Schema.parse({
      ...report,
      modelBindings: [
        {
          ...report.modelBindings[0],
          supportedReasoning: ["unsafe value"],
        },
      ],
    }),
  );
  assert.throws(() =>
    RuntimeProfileProbeReportSchema.parse({
      ...report,
      secretValue: "must-never-enter-probe-evidence",
    }),
  );

  const offer = {
    capabilityEvidence: [{ capability: "worker_commands", evidence: "probed" }],
    capacityPoolIds: [],
    certificationRefs: [],
    hostId: "host-main",
    hostInstanceId: "host-instance-1",
    isolation: { evidence: "declared", level: "none" },
    leaseUntil: "2026-08-26T00:02:00.000Z",
    maxConcurrent: 1,
    modelBindingDescriptors: [],
    observedAt: "2026-08-26T00:00:00.000Z",
    protocolFamily: "rah-worker-process/v1",
    revisionDigest: `sha256:${"3".repeat(64)}`,
    runtimeOfferId: "offer-main",
    runtimeProfileId: "codex-main",
    runtimeProfileRevisionId: "codex-main-revision-1",
    state: "available",
    supportedToolAccessModes: ["read_only", "workspace_write", "full_access"],
    workspaceMountDescriptors: [],
  } as const;
  assert.throws(() => RuntimeOfferSchema.parse(offer));
  assert.equal(
    RuntimeOfferSchema.parse({
      ...offer,
      probeReportRef: {
        probeDigest: report.probeDigest,
        probeReportId: report.probeReportId,
      },
    }).probeReportRef?.probeReportId,
    report.probeReportId,
  );
  assert.throws(() =>
    RuntimeOfferSchema.parse({
      ...offer,
      probeReportRef: {
        probeDigest: report.probeDigest,
        probeReportId: report.probeReportId,
      },
      supportedToolAccessModes: ["full_access", "full_access"],
    }),
  );
});
