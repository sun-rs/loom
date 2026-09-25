import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RuntimeProfileManifestV3 } from "@rah-os/protocol";

import {
  ProviderSessionStore,
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
} from "../src/index.ts";

test("Codex automatically resumes Host-private Provider sessions with Raft fallback rules", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-codex-provider-session-"));
  chmodSync(directory, 0o700);
  try {
    const executable = join(directory, "fake-codex-resume-server.mjs");
    const recordPath = join(directory, "resume-record.jsonl");
    writeFileSync(executable, fakeCodexServer, { mode: 0o700 });
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-codex-resume",
    });
    profileRegistry.initialize();
    const implementations = new RuntimeImplementationRegistry();
    const revision = profileRegistry.importManifest(manifest(executable));
    const report = profileRegistry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: directory }),
    );
    const active = profileRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    assert.deepEqual(
      active.manifest.adapter.fixedArgs,
      [],
      "the standing prompt arrives per RunAttempt through the activation lease",
    );
    for (const legacy of [["frozen legacy room worker prompt"], ["a", "b"]]) {
      const legacyRevision = profileRegistry.importManifest(
        manifest(executable, legacy),
      );
      const legacyReport = profileRegistry.recordProbeReport(
        await implementations.probeRevision(legacyRevision, { cwd: directory }),
      );
      const legacyActive = profileRegistry.activateRevision({
        contentDigest: legacyRevision.contentDigest,
        runtimeProfileRevisionId: legacyRevision.runtimeProfileRevisionId,
      });
      const create = (): unknown =>
        implementations.createRuntime(legacyActive, legacyReport, {
          cwd: directory,
          supervisorDirectory: join(directory, "supervisors"),
        });
      if (legacy.length === 1) {
        assert.doesNotThrow(create, "an old frozen manifest still launches");
      } else {
        assert.throws(create, /at most one legacy fixed Room worker prompt/u);
      }
    }
    profileRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    let strictContinuity = false;
    let promptDigest = "sha256-standing-prompt-digest";
    const createRuntime = () =>
      implementations.createRuntime(active, report, {
        activationEnvironment: () => ({
          // The daemon compiles the standing prompt per RunAttempt and appends
          // it here; the RuntimeProfile freezes no prompt of its own.
          args: [
            "--prompt",
            "canonical room worker prompt",
            "-c",
            "features.memories=true",
          ],
          env: {
            RAH_REQUIRE_SESSION_CONTINUITY: strictContinuity ? "1" : "0",
            FAKE_CODEX_RECORD_PATH: recordPath,
            RAH_PROVIDER_LAUNCH_ARGS_JSON: JSON.stringify({
              runtimeId: "codex",
              additionalArgs: ["--test-extra", "value with spaces"],
            }),
          },
          standingPromptDigest: promptDigest,
        }),
        cwd: directory,
        providerSessionStore: new ProviderSessionStore({
          rootDirectory: join(directory, "provider-sessions"),
        }),
        supervisorDirectory: join(directory, "supervisors"),
      });
    let runtime = createRuntime();
    const originalRuntime = runtime;
    const trajectory: unknown[] = [];
    const runs = new Map<string, Awaited<ReturnType<typeof runtime.start>>>();
    const runActivation = async (
      suffix: string,
      participantId = "agent-codex-resume",
      completion: "cancel" | "reap" = "reap",
      instance = false,
      requireExisting = false,
    ) => {
      const activationId = `activation-${suffix}`;
      const runAttemptId = `run-${suffix}`;
      const run = await runtime.start(
        {
          ...(instance
            ? {
                agent: {
                  instanceChannelId: "room-codex-resume",
                  instanceSessionRequired: requireExisting,
                  participantId,
                  schemaVersion: 1 as const,
                  agentDefinitionRevision: {
                    agentId: "instance-definition",
                    agentDefinitionRevisionId: "agent-definition-resume-v1",
                    revision: 1,
                    role: "reviewer",
                    instructionRefs: [],
                    skillRefs: [],
                    memoryPolicyRef: {
                      artifactId: "memory-resume",
                      versionId: "memory-resume-v1",
                      contentDigest: `sha256:${"b".repeat(64)}` as const,
                    },
                    executionPolicyRevisionId: "policy",
                    contentDigest: `sha256:${"a".repeat(64)}` as const,
                    createdBy: "owner",
                    createdAt: "2026-08-29T08:00:00.000Z",
                  },
                },
              }
            : {}),
          activationId,
          consumerId: `consumer-${suffix}`,
          contextManifest: contextManifest({
            activationId,
            contentDigest: active.contentDigest,
            participantId,
            runAttemptId,
            runtimeProfileRevisionId: active.runtimeProfileRevisionId,
            suffix,
          }),
          fromSeq: 1,
          hostId: "host-codex-resume",
          participantId,
          reason: "manual",
          roomId: "room-codex-resume",
          runAttemptId,
          toSeq: 1,
        },
        {
          recordTrajectory: async (activity) => {
            trajectory.push(activity);
          },
          // The local Host reports instance binding evidence (required).
          recordInstanceSessionBinding: async () => undefined,
          registerPrepared: async () => undefined,
        },
      );
      runs.set(suffix, run);
      if (completion === "cancel") {
        await waitForRecordedMethod(recordPath, activationId, "turn/start");
        return { exit: await runtime.cancel(run), run };
      }
      return { exit: await runtime.reap(run), run };
    };

    assert.equal(
      (await runActivation("strict-seed", "instance-strict")).exit.code,
      0,
    );
    strictContinuity = true;
    const lost = await runActivation("strict-missing", "instance-strict");
    assert.equal(
      lost.exit.code,
      1,
      "bound instance must not silently create a replacement session",
    );
    assert.equal(lost.exit.failure?.retryDisposition, "sticky_terminal");
    strictContinuity = false;
    assert.equal((await runActivation("resume-fresh")).exit.code, 0);
    assert.equal((await runActivation("resume-resumed")).exit.code, 0);
    assert.equal((await runActivation("resume-missing")).exit.code, 0);
    const unavailableModel = await runActivation("model-unavailable");
    assert.equal(unavailableModel.exit.code, 1);
    assert.equal(unavailableModel.exit.failure?.errorClass, "ModelConfigError");
    assert.equal(
      unavailableModel.exit.failure?.retryDisposition,
      "sticky_terminal",
      "an unavailable configured model must not trigger repeated paid attempts",
    );
    assert.match(
      unavailableModel.exit.failure?.message ?? "",
      /not supported by any configured account/,
    );
    const permission = await runActivation("resume-permission");
    assert.equal(permission.exit.code, 1);
    assert.equal(
      (await runActivation("codex-cancel-seed", "agent-codex-cancel", "cancel"))
        .exit.code,
      0,
    );
    assert.equal(
      (await runActivation("codex-cancel-run", "agent-codex-cancel")).exit.code,
      0,
    );

    assert.equal(
      (await runActivation("instance-initial", "instance-stable", "reap", true))
        .exit.code,
      0,
    );
    runtime = createRuntime(); // Recreate adapter and store from disk, as after Host restart.
    promptDigest = "changed-compiler-or-runtime-config";
    assert.equal(
      (
        await runActivation(
          "instance-config-change",
          "instance-stable",
          "reap",
          true,
          true,
        )
      ).exit.code,
      0,
    );

    // Lost Host records must not dispatch even a new native thread/start.
    rmSync(join(directory, "provider-sessions"), {
      recursive: true,
      force: true,
    });
    await assert.rejects(
      runActivation(
        "instance-binding-lost",
        "instance-stable",
        "reap",
        true,
        true,
      ),
      /RAH_SESSION_CONTINUITY_REQUIRED/,
    );
    const records = readFileSync(recordPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(
      records.filter(
        (r) =>
          r.activationId === "activation-strict-missing" &&
          r.frame?.method === "thread/start",
      ).length,
      0,
      "no fresh thread after failed resume",
    );
    for (const record of records.filter((entry) => entry.args)) {
      assert.ok(record.args.includes("value with spaces"));
      assert.ok(record.args.includes("--test-extra"));
      assert.ok(
        record.args.lastIndexOf("features.memories=false") >
          record.args.lastIndexOf("features.memories=true"),
        "managed policy wins over inherited arguments",
      );
      for (const key of [
        "features.memories",
        "memories.generate_memories",
        "memories.use_memories",
        // Full review batch 3 P2-2: no native sub-agents or goals that start
        // turns outside this instance's lane (codex-cli 0.156.1 feature keys).
        "features.multi_agent",
        "features.goals",
      ]) {
        assert.ok(
          record.args.includes(`${key}=false`),
          `${key} disabled on every app-server spawn`,
        );
      }
    }
    for (const record of records.filter((entry) =>
      ["thread/start", "thread/resume"].includes(entry.frame?.method),
    )) {
      assert.equal(record.frame.params.config["memories.use_memories"], false);
      assert.equal(
        record.frame.params.config["memories.generate_memories"],
        false,
      );
      assert.equal(record.frame.params.config["features.memories"], false);
      if (record.frame.method === "thread/resume")
        assert.equal(record.frame.params.excludeTurns, true);
    }
    const methodsFor = (suffix: string): string[] =>
      records
        .filter((record) => record.activationId === `activation-${suffix}`)
        .map((record) => record.frame?.method)
        .filter(
          (method): method is string =>
            typeof method === "string" && !method.startsWith("process/"),
        );
    assert.deepEqual(methodsFor("instance-binding-lost"), []);
    assert.equal(methodsFor("instance-initial").includes("thread/start"), true);
    assert.equal(
      methodsFor("instance-config-change").includes("thread/resume"),
      true,
    );
    assert.equal(
      methodsFor("instance-config-change").includes("thread/start"),
      false,
    );
    assert.equal(methodsFor("resume-fresh").includes("thread/start"), true);
    assert.equal(methodsFor("resume-fresh").includes("thread/resume"), false);
    assert.equal(methodsFor("resume-resumed").includes("thread/resume"), true);
    assert.equal(methodsFor("resume-resumed").includes("thread/start"), false);
    assert.deepEqual(
      methodsFor("resume-missing").filter((method) =>
        method.startsWith("thread/"),
      ),
      ["thread/resume", "thread/start"],
    );
    assert.equal(
      methodsFor("resume-permission").includes("thread/resume"),
      true,
    );
    assert.equal(
      methodsFor("resume-permission").includes("thread/start"),
      false,
    );
    assert.deepEqual(methodsFor("codex-cancel-seed"), [
      "initialize",
      "initialized",
      "thread/start",
      "turn/start",
      "turn/interrupt",
    ]);
    // Full review batch 2 (contract §3): turn/start accepted the first turn's
    // input before the Host interrupted it, so that thread is bound and the
    // next run resumes it instead of silently starting a replacement.
    assert.equal(
      methodsFor("codex-cancel-run").includes("thread/resume"),
      true,
      "an interrupted first turn whose input was accepted stays bound",
    );
    assert.equal(
      methodsFor("codex-cancel-run").includes("thread/start"),
      false,
    );
    assert.equal(
      records.find(
        (record) =>
          record.activationId === "activation-codex-cancel-run" &&
          record.frame?.method === "thread/resume",
      )?.frame?.params?.threadId,
      "codex-thread-cancelled",
    );
    const cancelRecords = records.filter(
      (record) => record.activationId === "activation-codex-cancel-seed",
    );
    const interruptFrame = cancelRecords.find(
      (record) => record.frame?.method === "turn/interrupt",
    )?.frame;
    assert.deepEqual(interruptFrame?.params, {
      threadId: "codex-thread-cancelled",
      turnId: "turn-activation-codex-cancel-seed",
    });
    assert.deepEqual(
      cancelRecords.find((record) => record.frame?.id === "cancel-command")
        ?.frame?.result,
      { decision: "cancel" },
    );
    assert.deepEqual(
      cancelRecords.find((record) => record.frame?.id === "cancel-permissions")
        ?.frame?.error,
      { code: -32800, message: "turn was interrupted" },
    );
    assert.equal(
      cancelRecords.some(
        (record) => record.frame?.method === "process/SIGTERM",
      ),
      false,
      "the supervisor must let the driver interrupt the active turn before signalling the Provider child",
    );
    assert.doesNotMatch(
      JSON.stringify(trajectory),
      /codex-thread-(persisted|fallback)/u,
    );
    assert.match(JSON.stringify(trajectory), /此前 Codex 会话无法恢复/u);
    assert.match(JSON.stringify(trajectory), /工作轮次结束：interrupted/u);
    assert.doesNotMatch(
      JSON.stringify(originalRuntime.diagnostics(permission.run)),
      /codex-thread-fallback/u,
    );
    assert.doesNotMatch(
      JSON.stringify(
        originalRuntime.diagnostics(runs.get("codex-cancel-seed")!),
      ),
      /codex-thread-cancelled/u,
    );
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("S3: an instance's private turn after a channel turn resumes the same native session with its own Room scope", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-codex-private-box-"));
  chmodSync(directory, 0o700);
  try {
    const executable = join(directory, "fake-codex-resume-server.mjs");
    const recordPath = join(directory, "resume-record.jsonl");
    writeFileSync(executable, fakeCodexServer, { mode: 0o700 });
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-codex-resume",
    });
    profileRegistry.initialize();
    const implementations = new RuntimeImplementationRegistry();
    const revision = profileRegistry.importManifest(manifest(executable));
    const report = profileRegistry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: directory }),
    );
    const active = profileRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    const runtime = implementations.createRuntime(active, report, {
      activationEnvironment: () => ({
        args: ["--prompt", "FAKE standing prompt"],
        env: { FAKE_CODEX_RECORD_PATH: recordPath },
        standingPromptDigest: "sha256-standing-prompt-digest",
      }),
      cwd: directory,
      providerSessionStore: new ProviderSessionStore({
        rootDirectory: join(directory, "provider-sessions"),
      }),
      supervisorDirectory: join(directory, "supervisors"),
    });
    const participantId = "instance-shared-lane";
    const bindings: string[] = [];
    let lastDiag: unknown;
    const turn = async (
      suffix: string,
      roomId: string,
      fromSeq: number,
      toSeq: number,
      requireExisting: boolean,
    ) => {
      const activationId = `activation-${suffix}`;
      const runAttemptId = `run-${suffix}`;
      const run = await runtime.start(
        {
          agent: {
            // The instance's channel stays its origin on every turn; only the
            // Activation's Room names the box this turn serves.
            instanceChannelId: "room-channel",
            instanceSessionRequired: requireExisting,
            participantId,
            schemaVersion: 1 as const,
            agentDefinitionRevision: {
              agentId: "instance-definition",
              agentDefinitionRevisionId: "agent-definition-resume-v1",
              revision: 1,
              role: "reviewer",
              instructionRefs: [],
              skillRefs: [],
              memoryPolicyRef: {
                artifactId: "memory-resume",
                versionId: "memory-resume-v1",
                contentDigest: `sha256:${"b".repeat(64)}` as const,
              },
              executionPolicyRevisionId: "policy",
              contentDigest: `sha256:${"a".repeat(64)}` as const,
              createdBy: "owner",
              createdAt: "2026-08-29T08:00:00.000Z",
            },
          },
          activationId,
          consumerId: `consumer-${suffix}`,
          contextManifest: {
            ...contextManifest({
              activationId,
              contentDigest: active.contentDigest,
              participantId,
              runAttemptId,
              runtimeProfileRevisionId: active.runtimeProfileRevisionId,
              suffix,
            }),
            eventRanges: [{ fromSeq, toSeq }],
            roomId,
            throughRoomSeq: toSeq,
          },
          fromSeq,
          hostId: "host-codex-resume",
          participantId,
          reason: "manual",
          roomId,
          runAttemptId,
          toSeq,
        },
        {
          recordTrajectory: async () => undefined,
          recordInstanceSessionBinding: async (input) => {
            bindings.push(input.runAttemptId);
          },
          registerPrepared: async () => undefined,
        },
      );
      const exit = await runtime.reap(run);
      lastDiag = runtime.diagnostics(run);
      return exit;
    };
    const first = await turn("channel", "room-channel", 3, 5, false);
    assert.equal(first.code, 0, JSON.stringify(lastDiag));
    // The Kernel now requires the bound session for every Room of this lane.
    assert.equal((await turn("private", "room-private", 2, 2, true)).code, 0);
    assert.equal((await turn("back", "room-channel", 6, 7, true)).code, 0);
    const records = readFileSync(recordPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const of = (suffix: string) =>
      records.filter((r) => r.activationId === `activation-${suffix}`);
    const threadCalls = (suffix: string) =>
      of(suffix)
        .filter((r) => String(r.frame?.method).startsWith("thread/"))
        .map((r) => [r.frame.method, r.frame.params?.threadId]);
    assert.deepEqual(threadCalls("channel"), [["thread/start", undefined]]);
    assert.deepEqual(threadCalls("private"), [
      ["thread/resume", "codex-thread-persisted"],
    ]);
    assert.deepEqual(threadCalls("back"), [
      ["thread/resume", "codex-thread-persisted"],
    ]);
    assert.deepEqual(
      ["channel", "private", "back"].map(
        (suffix) => of(suffix).find((r) => r.env)?.env,
      ),
      [
        { room: "room-channel", from: "3", to: "5" },
        { room: "room-private", from: "2", to: "2" },
        { room: "room-channel", from: "6", to: "7" },
      ],
    );
    assert.deepEqual(bindings, ["run-channel", "run-private", "run-back"]);
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

function manifest(
  executable: string,
  fixedArgs: readonly string[] = [],
): RuntimeProfileManifestV3 {
  return {
    adapter: {
      config: { diagnosticByteLimit: 262_144, terminationGraceMs: 1_000 },
      executable,
      fixedArgs: [...fixedArgs],
      kind: "codex-app-server/v1",
    },
    credentialSlots: [],
    declaredCapabilities: ["worker_commands"],
    displayName: "Fake Codex resume server",
    manifestVersion: 3,
    modelCatalogProbe: { kind: "codex-cli/v1" },
    protocolFamily: "rah-worker-process/v1",
    recoveryDrivers:
      process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
    runtimeProfileId: "fake-codex-resume-server",
    staticEnv: {},
    workspacePolicy: { allowedModes: ["in_place"] },
  };
}

function contextManifest(input: {
  activationId: string;
  contentDigest: string;
  participantId: string;
  runAttemptId: string;
  runtimeProfileRevisionId: string;
  suffix: string;
}) {
  return {
    activationId: input.activationId,
    agentDefinition: {
      agentDefinitionRevisionId: "agent-definition-resume-v1",
      contentDigest: `sha256:${"a".repeat(64)}` as const,
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "memory-resume",
        contentDigest: `sha256:${"b".repeat(64)}` as const,
        versionId: "memory-resume-v1",
      },
      skillRefs: [],
    },
    contentDigest: `sha256:${"c".repeat(64)}` as const,
    contextManifestId: `context-resume-${input.suffix}`,
    createdAt: "2026-08-29T08:00:00.000Z",
    eventRanges: [{ fromSeq: 1, toSeq: 1 }],
    participantId: input.participantId,
    placement: {
      placementId: "placement-codex-resume",
      runtimeProfileDigest: input.contentDigest as `sha256:${string}`,
      runtimeProfileRevisionId: input.runtimeProfileRevisionId,
      workspaceDefinitionId: "workspace-codex-resume",
      workspaceMode: "in_place" as const,
      workspaceMountDigest: `sha256:${"d".repeat(64)}` as const,
      workspaceMountRevisionId: "workspace-mount-codex-resume-v1",
    },
    roomId: "room-codex-resume",
    runAttemptId: input.runAttemptId,
    schemaVersion: 1 as const,
    throughRoomSeq: 1,
  };
}

async function waitForRecordedMethod(
  recordPath: string,
  activationId: string,
  method: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    let text = "";
    try {
      text = readFileSync(recordPath, "utf8");
    } catch {
      // The fixture creates the record file on its first request.
    }
    if (
      text
        .trim()
        .split("\n")
        .filter(Boolean)
        .some((line) => {
          const record = JSON.parse(line);
          return (
            record.activationId === activationId &&
            record.frame?.method === method
          );
        })
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${activationId} ${method}`);
}

const fakeCodexServer = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
if (args.join(" ") === "debug models" || args.join(" ") === "debug models --bundled") {
  process.stdout.write(JSON.stringify({models:[{slug:"gpt-test",visibility:"list",supported_in_api:true,supported_reasoning_levels:[{effort:"low"}],service_tiers:[]}]}));
  process.exit(0);
}
const activationId = process.env.RAH_ACTIVATION_ID;
const record = (value) => appendFileSync(process.env.FAKE_CODEX_RECORD_PATH, JSON.stringify({activationId,...value}) + "\\n");
record({args,env:{room:process.env.RAH_ROOM_ID,from:process.env.RAH_FROM_SEQ,to:process.env.RAH_TO_SEQ}});
const rl = createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
let threadId;
let activeTurnId;
const cancelledApprovalResponses = new Set();
let cancelledTurnCompleted = false;
process.on("SIGTERM", () => {
  record({frame:{method:"process/SIGTERM"}});
  process.exit(0);
});
const finishCancelledTurn = () => {
  if (cancelledTurnCompleted || cancelledApprovalResponses.size < 2) return;
  cancelledTurnCompleted = true;
  send({jsonrpc:"2.0",method:"turn/completed",params:{threadId,turn:{id:activeTurnId,status:"interrupted"}}});
};
rl.on("line", (line) => {
  const frame = JSON.parse(line); record({frame});
  if (activationId === "activation-codex-cancel-seed" && (frame.id === "cancel-command" || frame.id === "cancel-permissions") && frame.method === undefined) {
    cancelledApprovalResponses.add(frame.id);
    finishCancelledTurn();
    return;
  }
  if (frame.method === "initialize") send({jsonrpc:"2.0",id:frame.id,result:{userAgent:"fake-codex/1"}});
  else if (frame.method === "initialized") {}
  else if (frame.method === "thread/resume") {
    if (activationId.endsWith("missing")) send({jsonrpc:"2.0",id:frame.id,error:{code:-32000,message:"no rollout found for thread"}});
    else if (activationId.endsWith("permission")) send({jsonrpc:"2.0",id:frame.id,error:{code:-32000,message:"permission denied"}});
    else { threadId = frame.params.threadId; send({jsonrpc:"2.0",id:frame.id,result:{thread:{id:threadId}}}); }
  } else if (frame.method === "thread/start") {
    threadId = activationId === "activation-codex-cancel-seed"
      ? "codex-thread-cancelled"
      : activationId.endsWith("missing") ? "codex-thread-fallback" : "codex-thread-persisted";
    send({jsonrpc:"2.0",id:frame.id,result:{thread:{id:threadId}}});
  } else if (frame.method === "turn/start") {
    activeTurnId = "turn-" + activationId;
    send({jsonrpc:"2.0",id:frame.id,result:{turn:{id:activeTurnId,status:"inProgress"}}});
    if (activationId.endsWith("model-unavailable")) {
      send({jsonrpc:"2.0",method:"turn/completed",params:{threadId,turn:{id:activeTurnId,status:"failed",error:{message:"Model gpt-test is not supported by any configured account in this group",codexErrorInfo:"other"}}}});
    } else if (activationId !== "activation-codex-cancel-seed") {
      send({jsonrpc:"2.0",method:"turn/completed",params:{threadId,turn:{id:activeTurnId,status:"completed"}}});
    }
  } else if (frame.method === "turn/interrupt") {
    send({jsonrpc:"2.0",id:frame.id,result:{}});
    if (activationId === "activation-codex-cancel-seed" && frame.params.threadId === threadId && frame.params.turnId === activeTurnId) {
      send({jsonrpc:"2.0",id:"cancel-command",method:"item/commandExecution/requestApproval",params:{threadId,turnId:activeTurnId,itemId:"command-after-cancel"}});
      send({jsonrpc:"2.0",id:"cancel-permissions",method:"item/permissions/requestApproval",params:{threadId,turnId:activeTurnId,permissions:{network:{enabled:true}}}});
    }
  }
});
`;
