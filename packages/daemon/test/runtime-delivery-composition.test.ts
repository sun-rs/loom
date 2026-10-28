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
import type {
  RuntimeProfileManifestV2,
  RuntimeProfileManifestV3,
} from "@rah-os/protocol";

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
        const flags = [
          "LOOM_CODEX_FINAL_OUTPUT_TRIAL",
          "LOOM_OPENCODE_FINAL_OUTPUT_TRIAL",
          "LOOM_CLAUDE_NATIVE_FINAL_TRIAL",
          "LOOM_OPENCODE_NATIVE_FINAL_TRIAL",
          "LOOM_CODEX_NATIVE_FINAL_TRIAL",
          "LOOM_CODEX_EXEC_NATIVE_FINAL_TRIAL",
          "LOOM_KIMI_NATIVE_FINAL_TRIAL",
          "LOOM_PI_NATIVE_FINAL_TRIAL",
        ] as const;
        const saved = Object.fromEntries(
          flags.map((key) => [key, process.env[key]]),
        );
        function setFlags(environment: Record<string, string> = {}) {
          for (const key of flags) {
            if (environment[key] === undefined) delete process.env[key];
            else process.env[key] = environment[key];
          }
        }
        const probeKinds: Partial<
          Record<
            RuntimeProfileManifestV3["adapter"]["kind"],
            RuntimeProfileManifestV3["modelCatalogProbe"]["kind"]
          >
        > = {
          "codex-app-server/v1": "codex-cli/v1",
          "codex-exec/v1": "codex-cli/v1",
          "claude-stream-json/v1": "claude-cli/v1",
          "opencode-server/v1": "opencode-cli/v1",
          "kimi-acp/v1": "kimi-cli/v1",
          "pi-print-json/v1": "pi-cli/v1",
          "agy-print-json/v1": "agy-cli/v1",
        };
        const revisionFor = (
          kind: RuntimeProfileManifestV3["adapter"]["kind"],
        ) => ({
          ...revision,
          manifest: {
            ...manifest,
            manifestVersion: 3 as const,
            adapter: { ...manifest.adapter, kind },
            modelCatalogProbe: { kind: probeKinds[kind] ?? "pi-cli/v1" },
          },
        });
        try {
          await t.test(
            "cold defaults, explicit rollback and unsupported entry fallback reach the actual factory",
            () => {
              for (const [kind, flag, defaultNative] of [
                ["pi-print-json/v1", "LOOM_PI_NATIVE_FINAL_TRIAL", true],
                ["kimi-acp/v1", "LOOM_KIMI_NATIVE_FINAL_TRIAL", true],
                ["codex-exec/v1", "LOOM_CODEX_EXEC_NATIVE_FINAL_TRIAL", false],
              ] as const) {
                for (const value of [
                  undefined,
                  "0",
                  "1",
                  "true",
                  "",
                ] as const) {
                  setFlags(value === undefined ? {} : { [flag]: value });
                  createConfiguredRuntime({
                    ...runtimeInput,
                    runtimeProfileRevision: revisionFor(kind),
                  });
                  assert.equal(
                    options?.nativeFinalText,
                    value === "1" || (value === undefined && defaultNative),
                    `${kind}: ${value}`,
                  );
                }
              }
              // Unrelated switches never promote an unverified cold entry.
              setFlags(Object.fromEntries(flags.map((key) => [key, "1"])));
              for (const kind of [
                "generic-process/v1",
                "claude-stream-json/v1",
                "codex-app-server/v1",
                "opencode-server/v1",
                "agy-print-json/v1",
              ] as const) {
                createConfiguredRuntime({
                  ...runtimeInput,
                  runtimeProfileRevision: revisionFor(kind),
                });
                assert.equal(
                  options?.nativeFinalText,
                  kind === "agy-print-json/v1",
                  kind,
                );
              }
            },
          );
          await t.test(
            "warm defaults preserve explicit experiments, rollback and per-CLI selection at the actual factory",
            () => {
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
              let selected:
                { native: boolean; structured: boolean } | undefined;
              t.mock.method(
                implementations,
                "createWarmRuntime",
                (
                  ...args: Parameters<
                    RuntimeImplementationRegistry["createWarmRuntime"]
                  >
                ) => {
                  selected = {
                    native: args[3].nativeFinalText === true,
                    structured: args[3].explicitFinalOutput === true,
                  };
                  return adapter;
                },
              );
              for (const [kind, nativeFlag, structuredFlag] of [
                [
                  "codex-app-server/v1",
                  "LOOM_CODEX_NATIVE_FINAL_TRIAL",
                  "LOOM_CODEX_FINAL_OUTPUT_TRIAL",
                ],
                [
                  "claude-stream-json/v1",
                  "LOOM_CLAUDE_NATIVE_FINAL_TRIAL",
                  undefined,
                ],
                [
                  "opencode-server/v1",
                  "LOOM_OPENCODE_NATIVE_FINAL_TRIAL",
                  "LOOM_OPENCODE_FINAL_OUTPUT_TRIAL",
                ],
              ] as const) {
                const cases: [Record<string, string>, boolean, boolean][] = [
                  [{}, true, false],
                  [{ [nativeFlag]: "1" }, true, false],
                  [{ [nativeFlag]: "0" }, false, false],
                  [{ [nativeFlag]: "true" }, false, false],
                  [{ [nativeFlag]: "" }, false, false],
                  // Other CLIs' flags cannot override this CLI's explicit rollback.
                  [
                    Object.fromEntries(
                      flags
                        .map((key) => [key, key === nativeFlag ? "0" : "1"])
                        .filter(([key]) => key !== structuredFlag),
                    ),
                    false,
                    false,
                  ],
                ];
                if (structuredFlag)
                  cases.push(
                    [{ [structuredFlag]: "1" }, false, true],
                    [{ [structuredFlag]: "1", [nativeFlag]: "0" }, false, true],
                    [{ [structuredFlag]: "1", [nativeFlag]: "1" }, true, false],
                    [{ [structuredFlag]: "true" }, true, false],
                  );
                for (const [environment, native, structured] of cases) {
                  setFlags(environment);
                  selected = undefined;
                  assert.equal(
                    createConfiguredRuntime({
                      ...runtimeInput,
                      warmRuntimePool: pool,
                      warmRuntimeKinds: new Set([kind]),
                      runtimeProfileRevision: revisionFor(kind),
                    }),
                    adapter,
                  );
                  assert.deepEqual(
                    selected,
                    { native, structured },
                    `${kind}: ${JSON.stringify(environment)}`,
                  );
                }
              }
            },
          );
        } finally {
          for (const key of flags) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
          }
        }
      }
    } finally {
      registry.close();
      kernel.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
