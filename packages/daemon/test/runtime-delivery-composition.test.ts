import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AgentMemoryCoordinator,
  GenericProcessAdapter,
  InstanceRuntimePool,
  RuntimeProcessHygiene,
  LeftoverProcessSweeper,
  createSystemProcessTable,
  createKernelAgentHostControlPort,
  RuntimeCredentialEnvironmentBinding,
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
  type ActivationEnvelope,
  type RuntimeCreationOptions,
} from "@rah-os/agent-host";
import { RoomKernel } from "@rah-os/kernel";
import type { RuntimeProfileManifestV2 } from "@rah-os/protocol";

import { createConfiguredRuntime } from "../src/runtime-profile-composition.ts";

for (const mode of ["direct", "gated", undefined] as const) {
  test(`activation composition derives ${mode ?? "unknown"} delivery and rereads Guide for every Run`, async (t) => {
    const directory = await mkdtemp(
      join(tmpdir(), "rah-delivery-composition-"),
    );
    const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
    const registry = new RuntimeProfileRegistry({
      databasePath: join(directory, "profiles.db"),
      hostId: "host-delivery",
    });
    try {
      kernel.initialize();
      registry.initialize();
      const agent = kernel.provisionPrincipal({
        kind: "agent",
        handle: "delivery-agent",
      });
      const host = kernel.authenticateHostAccessToken(
        kernel.provisionHostCredential({
          hostId: "host-delivery",
          participantIds: [agent.principal.principalId],
        }).accessToken,
      );
      const manifest: RuntimeProfileManifestV2 = {
        manifestVersion: 2,
        runtimeProfileId: "delivery-fixture",
        displayName: "Delivery composition fixture",
        adapter: {
          kind: "generic-process/v1",
          executable: process.execPath,
          fixedArgs: [],
          config: {},
        },
        credentialSlots: [],
        declaredCapabilities: ["worker_commands"],
        protocolFamily: "rah-worker-process/v1",
        recoveryDrivers: [],
        staticEnv: {},
        workspacePolicy: { allowedModes: ["in_place"] },
      };
      const revision = registry.importManifest(manifest);
      const implementations = new RuntimeImplementationRegistry();
      const probeReport = registry.recordProbeReport(
        await implementations.probeRevision(revision, { cwd: directory }),
      );
      const adapter = new GenericProcessAdapter({
        args: [],
        command: process.execPath,
        cwd: directory,
        nativeBusyInput: true,
        guideRuntimeId: "fixture-runtime",
        ...(mode === undefined ? {} : { busyInputMode: mode }),
      });
      let options: RuntimeCreationOptions | undefined;
      t.mock.method(
        implementations,
        "createRuntime",
        (
          _revision: Parameters<
            RuntimeImplementationRegistry["createRuntime"]
          >[0],
          _probe: Parameters<RuntimeImplementationRegistry["createRuntime"]>[1],
          captured: RuntimeCreationOptions,
        ) => {
          options = captured;
          return adapter;
        },
      );
      let released = 0;
      let revoked = 0;
      let issued = 0;
      let enabled = false;
      const checkedIds: (string | undefined)[] = [];
      const credentials = new RuntimeCredentialEnvironmentBinding({
        manifest,
        resolvers: {},
      });
      t.mock.method(credentials, "resolve", async () => ({
        env: {},
        release: () => {
          released += 1;
        },
      }));
      const memory = new AgentMemoryCoordinator({
        rootDirectory: join(directory, "memory"),
        wake: () => false,
      });
      t.mock.method(memory, "prepareRuntimeActivation", async () => ({
        env: {},
      }));
      const runtimeInput: Parameters<typeof createConfiguredRuntime>[0] = {
        agentMemoryCoordinator: memory,
        credentialEnvironment: credentials,
        cwd: directory,
        host,
        implementations,
        probeReport,
        runtimeProfileRegistry: registry,
        runtimeProfileRevision: revision,
        supervisorDirectory: directory,
        launchEnvironment: (_runtimeId, agentId) => {
          assert.equal(agentId, "definition-delivery");
          return {
            AGENT_ENV_FIXTURE: agentId,
            RAH_PROVIDER_LAUNCH_ARGS_JSON: JSON.stringify({
              runtimeId: "claude",
              additionalArgs: enabled ? ["--verbose"] : [],
            }),
          };
        },
        guideEnabled: (id) => {
          checkedIds.push(id);
          return enabled;
        },
        workerService: {
          origin: "http://127.0.0.1:1",
          issueActivationCredential: () => {
            issued += 1;
            return {
              accessToken: `rah_wat_delivery_fixture_${String(issued)}_0123456789`,
              expiresAt: "2099-01-01T00:00:00.000Z",
              revoke: () => {
                revoked += 1;
              },
            };
          },
        },
      };
      const runtime = createConfiguredRuntime(runtimeInput);
      assert.equal(runtime, adapter);
      assert.deepEqual(
        checkedIds,
        [],
        "Guide must not be frozen during runtime construction",
      );
      assert.ok(options?.activationEnvironment);
      const environment = options.activationEnvironment;
      const prompts: string[] = [];
      for (const [index, guide] of [true, false, true].entries()) {
        enabled = guide;
        const scope: ActivationEnvelope = {
          activationId: `activation-${index}`,
          consumerId: "consumer-delivery",
          hostId: host.hostId,
          participantId: agent.principal.principalId,
          roomId: "room-delivery",
          reason: "manual",
          fromSeq: 1,
          toSeq: 1,
          runAttemptId: `run-${index}`,
          agent: {
            schemaVersion: 1,
            participantId: agent.principal.principalId,
            handle: "delivery-agent",
            agentDefinitionRevision: {
              environment: { AGENT_ENV_FIXTURE: "role-snapshot" },
              agentId: "definition-delivery",
              agentDefinitionRevisionId: "revision-delivery",
              contentDigest: `sha256:${"1".repeat(64)}`,
              createdAt: "2026-09-11T00:00:00.000Z",
              createdBy: "human-owner",
              executionPolicyRevisionId: "policy-delivery",
              instructionRefs: [],
              skillRefs: [],
              revision: 1,
              role: "Assistant",
              memoryPolicyRef: {
                artifactId: "memory-policy",
                versionId: "memory-v1",
                contentDigest: `sha256:${"2".repeat(64)}`,
              },
            },
          },
        };
        const lease = await environment(scope);
        try {
          const { execFileSync } = await import("node:child_process");
          assert.equal(
            execFileSync(
              process.execPath,
              ["-e", "process.stdout.write(process.env.AGENT_ENV_FIXTURE)"],
              { env: lease.env, encoding: "utf8" },
            ),
            "role-snapshot",
          );
          assert.deepEqual(
            JSON.parse(lease.env?.RAH_PROVIDER_LAUNCH_ARGS_JSON ?? "{}")
              .additionalArgs,
            guide ? ["--verbose"] : [],
          );
          assert.ok(lease.args);
          const promptIndex = lease.args.lastIndexOf("--prompt");
          assert.ok(
            promptIndex >= 0,
            "the composed lease must actually deliver the prompt argument",
          );
          const prompt = lease.args[promptIndex + 1];
          assert.ok(prompt);
          prompts.push(prompt);
          const expected = guide ? (mode ?? "wait") : "wait";
          assert.match(
            prompt,
            new RegExp(`Delivery mode at launch: ${expected}\\.`),
          );
          if (expected === "direct")
            assert.match(
              prompt,
              /batched, content-free inbox update into your current turn/u,
            );
          if (expected === "gated")
            assert.match(prompt, /allowed tool boundary/u);
          if (expected === "wait")
            assert.match(
              prompt,
              /does not proactively inject new Room notices/u,
            );
        } finally {
          await lease.release?.();
        }
      }
      assert.deepEqual(checkedIds, [
        "fixture-runtime",
        "fixture-runtime",
        "fixture-runtime",
      ]);
      assert.equal(released, 3);
      assert.equal(revoked, 3);
      assert.equal(issued, 3);
      assert.deepEqual(
        await readdir(join(directory, "worker-credentials")),
        [],
        "credential leases leave no token files behind",
      );
      if (mode !== undefined) assert.notEqual(prompts[0], prompts[1]);
      assert.equal(prompts[0], prompts[2]);
      if (mode === undefined) {
        await t.test(
          "Pi native final is opt-in and cannot select another CLI",
          () => {
            const before = process.env.LOOM_PI_NATIVE_FINAL_TRIAL;
            try {
              for (const [flag, kind, expected] of [
                [undefined, "pi-print-json/v1", false],
                ["true", "pi-print-json/v1", false],
                ["1", "pi-print-json/v1", true],
                ["1", "generic-process/v1", false],
              ] as const) {
                if (flag === undefined)
                  delete process.env.LOOM_PI_NATIVE_FINAL_TRIAL;
                else process.env.LOOM_PI_NATIVE_FINAL_TRIAL = flag;
                createConfiguredRuntime({
                  ...runtimeInput,
                  runtimeProfileRevision: {
                    ...revision,
                    manifest: {
                      ...manifest,
                      manifestVersion: 3,
                      adapter: { ...manifest.adapter, kind },
                      modelCatalogProbe: { kind: "pi-cli/v1" },
                    },
                  },
                });
                assert.equal(options?.nativeFinalText, expected);
              }
            } finally {
              if (before === undefined)
                delete process.env.LOOM_PI_NATIVE_FINAL_TRIAL;
              else process.env.LOOM_PI_NATIVE_FINAL_TRIAL = before;
            }
          },
        );
      }
      if (mode === undefined)
        await t.test(
          "final-output switches select only their own CLI and preserve the default",
          () => {
            const saved = [
              process.env.LOOM_CODEX_FINAL_OUTPUT_TRIAL,
              process.env.LOOM_OPENCODE_FINAL_OUTPUT_TRIAL,
              process.env.LOOM_CLAUDE_NATIVE_FINAL_TRIAL,
              process.env.LOOM_OPENCODE_NATIVE_FINAL_TRIAL,
              process.env.LOOM_CODEX_NATIVE_FINAL_TRIAL,
            ];
            const pool = new InstanceRuntimePool({
              control: createKernelAgentHostControlPort(kernel, host),
              hostGeneration: host.instanceId,
              hygiene: new RuntimeProcessHygiene({
                sweeper: new LeftoverProcessSweeper({
                  table: createSystemProcessTable(),
                }),
              }),
              stateDirectory: join(directory, "warm"),
            });
            let selected: boolean | undefined;
            let nativeSelected: boolean | undefined;
            t.mock.method(
              implementations,
              "createWarmRuntime",
              (
                ...args: Parameters<
                  RuntimeImplementationRegistry["createWarmRuntime"]
                >
              ) => {
                const warm = args[3];
                selected = warm.explicitFinalOutput;
                nativeSelected = warm.nativeFinalText === true;
                return adapter;
              },
            );
            try {
              for (const [
                codexFlag,
                openCodeFlag,
                adapterKind,
                expected,
                nativeFlag,
                nativeExpected = false,
                openCodeNativeFlag,
                codexNativeFlag,
              ] of [
                [
                  undefined,
                  undefined,
                  "codex-app-server/v1",
                  false,
                  undefined,
                  true,
                  undefined,
                  "1",
                ],
                [
                  undefined,
                  undefined,
                  "codex-app-server/v1",
                  false,
                  undefined,
                  false,
                  undefined,
                  "true",
                ],
                [
                  undefined,
                  undefined,
                  "claude-stream-json/v1",
                  false,
                  undefined,
                  false,
                  undefined,
                  "1",
                ],
                [undefined, undefined, "codex-app-server/v1", false],
                ["1", undefined, "codex-app-server/v1", true],
                [undefined, "1", "codex-app-server/v1", false],
                ["1", undefined, "opencode-server/v1", false],
                [undefined, "1", "opencode-server/v1", true],
                ["1", "1", "claude-stream-json/v1", false],
                ["true", undefined, "codex-app-server/v1", false],
                [
                  undefined,
                  undefined,
                  "claude-stream-json/v1",
                  false,
                  "1",
                  true,
                ],
                [
                  undefined,
                  undefined,
                  "codex-app-server/v1",
                  false,
                  "1",
                  false,
                ],
                [undefined, undefined, "opencode-server/v1", false, "1", false],
                [
                  undefined,
                  undefined,
                  "claude-stream-json/v1",
                  false,
                  "true",
                  false,
                ],
                [
                  undefined,
                  undefined,
                  "opencode-server/v1",
                  false,
                  undefined,
                  true,
                  "1",
                ],
                [
                  undefined,
                  "1",
                  "opencode-server/v1",
                  false,
                  undefined,
                  true,
                  "1",
                ],
                [
                  undefined,
                  undefined,
                  "opencode-server/v1",
                  false,
                  undefined,
                  false,
                  "true",
                ],
                [
                  undefined,
                  undefined,
                  "claude-stream-json/v1",
                  false,
                  undefined,
                  false,
                  "1",
                ],
                [
                  undefined,
                  undefined,
                  "codex-app-server/v1",
                  false,
                  undefined,
                  false,
                  "1",
                ],
              ] as const) {
                if (codexFlag === undefined)
                  delete process.env.LOOM_CODEX_FINAL_OUTPUT_TRIAL;
                else process.env.LOOM_CODEX_FINAL_OUTPUT_TRIAL = codexFlag;
                if (openCodeFlag === undefined)
                  delete process.env.LOOM_OPENCODE_FINAL_OUTPUT_TRIAL;
                else
                  process.env.LOOM_OPENCODE_FINAL_OUTPUT_TRIAL = openCodeFlag;
                if (nativeFlag === undefined)
                  delete process.env.LOOM_CLAUDE_NATIVE_FINAL_TRIAL;
                else process.env.LOOM_CLAUDE_NATIVE_FINAL_TRIAL = nativeFlag;
                if (openCodeNativeFlag === undefined)
                  delete process.env.LOOM_OPENCODE_NATIVE_FINAL_TRIAL;
                else
                  process.env.LOOM_OPENCODE_NATIVE_FINAL_TRIAL =
                    openCodeNativeFlag;
                if (codexNativeFlag === undefined)
                  delete process.env.LOOM_CODEX_NATIVE_FINAL_TRIAL;
                else
                  process.env.LOOM_CODEX_NATIVE_FINAL_TRIAL = codexNativeFlag;
                selected = undefined;
                assert.equal(
                  createConfiguredRuntime({
                    ...runtimeInput,
                    warmRuntimePool: pool,
                    warmRuntimeKinds: new Set([adapterKind]),
                    runtimeProfileRevision: {
                      ...revision,
                      manifest: {
                        ...manifest,
                        manifestVersion: 3,
                        modelCatalogProbe: {
                          kind:
                            adapterKind === "codex-app-server/v1"
                              ? "codex-cli/v1"
                              : adapterKind === "opencode-server/v1"
                                ? "opencode-cli/v1"
                                : "claude-cli/v1",
                        },
                        adapter: { ...manifest.adapter, kind: adapterKind },
                      },
                    },
                  }),
                  adapter,
                );
                assert.equal(
                  selected,
                  expected,
                  `${adapterKind}: codex=${codexFlag}, opencode=${openCodeFlag}`,
                );
                assert.equal(
                  nativeSelected,
                  nativeExpected,
                  `native text ${adapterKind}: ${nativeFlag}`,
                );
              }
            } finally {
              for (const [key, value] of [
                ["LOOM_CODEX_FINAL_OUTPUT_TRIAL", saved[0]],
                ["LOOM_OPENCODE_FINAL_OUTPUT_TRIAL", saved[1]],
                ["LOOM_CLAUDE_NATIVE_FINAL_TRIAL", saved[2]],
                ["LOOM_OPENCODE_NATIVE_FINAL_TRIAL", saved[3]],
                ["LOOM_CODEX_NATIVE_FINAL_TRIAL", saved[4]],
              ] as const) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
              }
            }
          },
        );
    } finally {
      registry.close();
      kernel.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
