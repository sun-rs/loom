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
  providerLaunchDefaults,
  ProviderSessionStore,
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
} from "../src/index.ts";

test("Claude custom native model ID reaches the CLI unchanged", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-claude-custom-model-"));
  try {
    const executable = join(directory, "fake-claude.mjs");
    const recordPath = join(directory, "record.jsonl");
    writeFileSync(executable, fakeClaude, { mode: 0o700 });
    const registry = new RuntimeProfileRegistry({
      databasePath: join(directory, "registry.db"),
      hostId: "host-claude",
    });
    registry.initialize();
    const implementations = new RuntimeImplementationRegistry();
    const revision = registry.importManifest(manifest(executable));
    const report = registry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: directory }),
    );
    const active = registry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    const runtime = implementations.createRuntime(
      active,
      report,
      {
        cwd: directory,
        supervisorDirectory: join(directory, "supervisors"),
        activationEnvironment: () => ({
          args: ["--prompt", "test prompt"],
          env: { FAKE_CLAUDE_RECORD_PATH: recordPath },
        }),
      },
      {
        source: "custom_model",
        runtime: "claude",
        modelId: "vendor/claude-special-v2",
      },
      "full_access",
    );
    const run = await runtime.start(
      {
        activationId: "activation-custom",
        consumerId: "consumer-custom",
        fromSeq: 1,
        toSeq: 1,
        hostId: "host-claude",
        participantId: "agent-custom",
        roomId: "room-custom",
        runAttemptId: "run-custom",
        reason: "manual",
      },
      { registerPrepared: async () => undefined },
    );
    assert.equal((await runtime.reap(run)).code, 0);
    const spawn = readFileSync(recordPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .find((row) => row.kind === "spawn");
    assert.equal(
      spawn.args[spawn.args.indexOf("--model") + 1],
      "vendor/claude-special-v2",
    );
    assert.equal(spawn.args.includes("--effort"), false);
    assert.deepEqual(
      JSON.parse(spawn.args[spawn.args.lastIndexOf("--settings") + 1]),
      { fastMode: false },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Claude version model and explicit effort both reach the CLI", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-claude-custom-model-"));
  try {
    const executable = join(directory, "fake-claude.mjs");
    const recordPath = join(directory, "record.jsonl");
    writeFileSync(executable, fakeClaude, { mode: 0o700 });
    const registry = new RuntimeProfileRegistry({
      databasePath: join(directory, "registry.db"),
      hostId: "host-claude",
    });
    registry.initialize();
    const implementations = new RuntimeImplementationRegistry();
    const revision = registry.importManifest(manifest(executable));
    const report = registry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: directory }),
    );
    const active = registry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    assert.throws(
      () =>
        implementations.createRuntime(
          active,
          report,
          {} as any,
          {
            source: "custom_model",
            runtime: "claude",
            modelId: "vendor/unknown",
            reasoning: "high",
          } as any,
        ),
      /unsupported custom model effort/,
    );
    assert.throws(
      () =>
        implementations.createRuntime(
          active,
          report,
          {} as any,
          {
            source: "custom_model",
            runtime: "claude",
            modelId: "claude-sonnet-4-6",
            reasoning: "xhigh",
          } as any,
        ),
      /unsupported custom model effort/,
    );
    const runtime = implementations.createRuntime(
      active,
      report,
      {
        cwd: directory,
        supervisorDirectory: join(directory, "supervisors"),
        activationEnvironment: () => ({
          args: ["--prompt", "test prompt"],
          env: { FAKE_CLAUDE_RECORD_PATH: recordPath },
        }),
      },
      {
        source: "custom_model",
        runtime: "claude",
        modelId: "claude-sonnet-5",
        reasoning: "high",
      },
      "full_access",
    );
    const run = await runtime.start(
      {
        activationId: "activation-custom",
        consumerId: "consumer-custom",
        fromSeq: 1,
        toSeq: 1,
        hostId: "host-claude",
        participantId: "agent-custom",
        roomId: "room-custom",
        runAttemptId: "run-custom",
        reason: "manual",
      },
      { registerPrepared: async () => undefined },
    );
    assert.equal((await runtime.reap(run)).code, 0);
    const spawn = readFileSync(recordPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .find((row) => row.kind === "spawn");
    assert.equal(
      spawn.args[spawn.args.indexOf("--model") + 1],
      "claude-sonnet-5",
    );
    assert.equal(spawn.args[spawn.args.indexOf("--effort") + 1], "high");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Claude binding without effort levels (Haiku) launches with --model and no --effort", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-claude-effortless-"));
  try {
    const executable = join(directory, "fake-claude.mjs");
    const recordPath = join(directory, "record.jsonl");
    writeFileSync(executable, fakeClaude, { mode: 0o700 });
    const registry = new RuntimeProfileRegistry({
      databasePath: join(directory, "registry.db"),
      hostId: "host-claude",
    });
    registry.initialize();
    const implementations = new RuntimeImplementationRegistry();
    const revision = registry.importManifest(manifest(executable));
    const report = registry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: directory }),
    );
    const active = registry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    const binding =
      report.reportVersion === 2
        ? report.modelBindings.find((b) => b.modelId === "haiku")
        : undefined;
    assert.ok(binding, "the probe publishes the effortless binding");
    assert.deepEqual(binding.supportedReasoning, []);
    const runtime = implementations.createRuntime(
      active,
      report,
      {
        cwd: directory,
        supervisorDirectory: join(directory, "supervisors"),
        activationEnvironment: () => ({
          args: ["--prompt", "test prompt"],
          env: { FAKE_CLAUDE_RECORD_PATH: recordPath },
        }),
      },
      {
        source: "explicit_binding",
        modelBindingId: binding.modelBindingId,
        modelId: binding.modelId,
        provider: binding.provider,
      },
      "full_access",
    );
    const run = await runtime.start(
      {
        activationId: "activation-effortless",
        consumerId: "consumer-effortless",
        fromSeq: 1,
        toSeq: 1,
        hostId: "host-claude",
        participantId: "agent-effortless",
        roomId: "room-effortless",
        runAttemptId: "run-effortless",
        reason: "manual",
      },
      { registerPrepared: async () => undefined },
    );
    assert.equal((await runtime.reap(run)).code, 0);
    const spawn = readFileSync(recordPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .find((row) => row.kind === "spawn");
    assert.deepEqual(
      spawn.args.filter((a: string) => a === "--model"),
      ["--model"],
    );
    assert.equal(spawn.args[spawn.args.indexOf("--model") + 1], "haiku");
    assert.equal(
      spawn.args.some((a: string) => a.startsWith("--effort")),
      false,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Claude stream-json resumes only accepted sessions and interrupts natively", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-claude-provider-session-"));
  chmodSync(directory, 0o700);
  try {
    const executable = join(directory, "fake-claude.mjs");
    const recordPath = join(directory, "claude-record.jsonl");
    writeFileSync(executable, fakeClaude, { mode: 0o700 });
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-claude",
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
    const binding =
      report.reportVersion === 2 ? report.modelBindings[0] : undefined;
    assert.notEqual(binding, undefined);
    let promptDigest = "sha256-standing-prompt-digest";
    let compatibleDigest: string | undefined;
    let strictContinuity = false;
    const runtime = implementations.createRuntime(
      active,
      report,
      {
        activationEnvironment: () => ({
          // The daemon compiles the standing prompt per RunAttempt and appends
          // it here; the RuntimeProfile freezes no prompt of its own.
          args: ["--prompt", "canonical room worker prompt"],
          env: {
            RAH_REQUIRE_SESSION_CONTINUITY: strictContinuity ? "1" : "0",
            FAKE_CLAUDE_RECORD_PATH: recordPath,
            RAH_PROVIDER_LAUNCH_ARGS_JSON: JSON.stringify({
              runtimeId: "claude",
              overrideArgs: [
                ...providerLaunchDefaults("claude"),
                "--test-extra",
                "value with spaces",
              ],
            }),
            CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0",
          },
          standingPromptDigest: promptDigest,
          ...(compatibleDigest === undefined
            ? {}
            : { compatibleStandingPromptDigest: compatibleDigest }),
        }),
        cwd: directory,
        providerSessionStore: new ProviderSessionStore({
          rootDirectory: join(directory, "provider-sessions"),
        }),
        supervisorDirectory: join(directory, "supervisors"),
      },
      {
        modelBindingId: binding!.modelBindingId,
        modelId: binding!.modelId,
        provider: binding!.provider,
        reasoning: "high",
        source: "explicit_binding",
        serviceTier: "fast",
      },
      "full_access",
    );
    assert.equal(runtime.busyInputSupported, true);
    assert.equal(runtime.busyInputMode, "direct");
    const trajectory: unknown[] = [];
    const runActivation = async (
      scenario: string,
      phase: "after" | "seed" | "run",
      completion: "cancel" | "reap" = "reap",
    ) => {
      const suffix = `${scenario}-${phase}`;
      const activationId = `activation-claude-${suffix}`;
      const participantId = `agent-claude-${scenario}`;
      const runAttemptId = `run-claude-${suffix}`;
      const run = await runtime.start(
        {
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
          hostId: "host-claude",
          participantId,
          reason: "manual",
          roomId: "room-claude",
          runAttemptId,
          toSeq: 1,
        },
        {
          recordTrajectory: async (activity) => {
            trajectory.push(activity);
          },
          registerPrepared: async () => undefined,
        },
      );
      if (completion === "cancel") {
        await waitForRecord(recordPath, activationId, "input");
        return await runtime.cancel(run);
      }
      return await runtime.reap(run);
    };

    assert.equal((await runActivation("strict-missing", "seed")).code, 0);
    strictContinuity = true;
    const lost = await runActivation("strict-missing", "run");
    assert.equal(
      lost.code,
      1,
      "bound instance must not silently create a replacement session",
    );
    assert.equal(lost.failure?.retryDisposition, "sticky_terminal");
    strictContinuity = false;
    assert.equal((await runActivation("resumed", "seed")).code, 0);
    compatibleDigest = promptDigest;
    promptDigest = "sha256-direct-prompt-digest";
    assert.equal((await runActivation("resumed", "run")).code, 0);
    compatibleDigest = undefined;
    assert.equal((await runActivation("resumed", "after")).code, 0);
    assert.equal((await runActivation("missing", "seed")).code, 0);
    assert.equal((await runActivation("missing", "run")).code, 0);
    assert.equal((await runActivation("cancel", "seed", "cancel")).code, 0);
    assert.equal((await runActivation("cancel", "run")).code, 0);
    for (const scenario of [
      "identity-drift",
      "tool-before-input",
      "abnormal-success",
    ]) {
      assert.notEqual(
        (await runActivation(scenario, "run")).code,
        0,
        `${scenario} must fail closed`,
      );
      assert.equal(
        (await runActivation(scenario, "after")).code,
        0,
        `the turn after ${scenario} runs`,
      );
    }

    const records = readFileSync(recordPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    for (const record of records.filter((r) => r.kind === "spawn")) {
      assert.deepEqual(
        JSON.parse(record.args[record.args.lastIndexOf("--settings") + 1]),
        { fastMode: true },
      );
      assert.equal(
        record.args[record.args.indexOf("--model") + 1],
        "claude-test",
      );
    }
    assert.equal(
      records.filter(
        (r) =>
          r.activationId === "activation-claude-strict-missing-run" &&
          r.kind === "spawn",
      ).length,
      1,
      "no fresh Claude child after failed resume",
    );
    for (const record of records.filter((entry) => entry.kind === "spawn")) {
      assert.ok(record.args.includes("value with spaces"));
      assert.ok(record.args.includes("--test-extra"));
      assert.equal(record.args.includes("--verbose"), true);
      // evo §40 B: bypass mode and the lane-stealing tools on every child.
      assert.equal(
        record.args[record.args.indexOf("--permission-mode") + 1],
        "bypassPermissions",
      );
      const disallowed =
        record.args[record.args.indexOf("--disallowed-tools") + 1].split(",");
      for (const tool of [
        "EnterPlanMode",
        "ExitPlanMode",
        "ScheduleWakeup",
        "CronCreate",
        "CronList",
        "CronDelete",
        "RemoteTrigger",
        "AskUserQuestion",
      ])
        assert.ok(disallowed.includes(tool), `${tool} disallowed`);
      assert.equal(
        record.autoMemoryDisabled,
        "1",
        "every fresh/resumed/fallback child disables automatic memory",
      );
    }
    const forActivation = (suffix: string) =>
      records.filter(
        (record) => record.activationId === `activation-claude-${suffix}`,
      );
    const firstSpawn = forActivation("resumed-seed").find(
      (record) => record.kind === "spawn",
    );
    assert.deepEqual(
      firstSpawn.args.filter((value: string) =>
        [
          "--input-format",
          "--output-format",
          "--permission-mode",
          "--model",
          "--effort",
        ].includes(value),
      ),
      [
        "--permission-mode",
        "--output-format",
        "--input-format",
        "--model",
        "--effort",
      ],
    );
    assert.equal(firstSpawn.args.includes("--replay-user-messages"), true);
    assert.equal(firstSpawn.args.includes("--include-partial-messages"), true);
    assert.equal(
      firstSpawn.args[firstSpawn.args.indexOf("--permission-mode") + 1],
      "bypassPermissions",
    );
    assert.equal(
      firstSpawn.args[firstSpawn.args.indexOf("--model") + 1],
      "claude-test",
    );
    assert.equal(
      firstSpawn.args[firstSpawn.args.indexOf("--effort") + 1],
      "high",
    );
    assert.equal(firstSpawn.systemPrompt, "canonical room worker prompt");

    const resumedSpawn = forActivation("resumed-run").find(
      (record) => record.kind === "spawn",
    );
    assert.equal(
      resumedSpawn.args[resumedSpawn.args.indexOf("--resume") + 1],
      "claude-session-resumed",
    );
    const migratedSpawn = forActivation("resumed-after").find(
      (record) => record.kind === "spawn",
    );
    assert.equal(
      migratedSpawn.args[migratedSpawn.args.indexOf("--resume") + 1],
      "claude-session-resumed",
    );
    assert.equal(
      forActivation("missing-run").filter((record) => record.kind === "spawn")
        .length,
      2,
      "a missing session may retry fresh only before exact input acceptance",
    );
    const missingSpawns = forActivation("missing-run").filter(
      (record) => record.kind === "spawn",
    );
    assert.equal(missingSpawns[0].args.includes("--resume"), true);
    assert.equal(missingSpawns[1].args.includes("--resume"), false);
    assert.equal(
      forActivation("cancel-seed").some(
        (record) => record.kind === "signal" && record.signal === "SIGINT",
      ),
      true,
    );
    // Full review batch 2 (contract §3): the cancelled turn's input was
    // accepted under a confirmed identity, so the next turn resumes that
    // session; so does a turn whose CLI exited abnormally after success.
    for (const after of ["cancel-run", "abnormal-success-after"]) {
      const spawn = forActivation(after).find(
        (record) => record.kind === "spawn",
      );
      assert.equal(
        spawn?.args[spawn.args.indexOf("--resume") + 1],
        "claude-session-resumed",
        `${after} resumes the accepted session`,
      );
    }
    // Identity or input order in doubt: nothing is bound.
    for (const scenario of ["identity-drift", "tool-before-input"]) {
      assert.equal(
        forActivation(`${scenario}-after`).some(
          (record) =>
            record.kind === "spawn" && record.args.includes("--resume"),
        ),
        false,
        `${scenario} must leave the next turn fresh`,
      );
    }
    const projected = JSON.stringify(trajectory);
    assert.match(projected, /正在读取 Room 状态/u);
    assert.match(projected, /Bash已完成/u);
    assert.match(projected, /此前 Claude 会话无法恢复/u);
    assert.match(projected, /工作轮次结束：interrupted/u);
    assert.match(projected, /changed Provider session identity/u);
    assert.match(projected, /tool activity before exact input acceptance/u);
    assert.match(projected, /exited abnormally after success/u);
    assert.doesNotMatch(projected, /claude-session-(resumed|replacement)/u);
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
      kind: "claude-stream-json/v1",
    },
    credentialSlots: [],
    declaredCapabilities: ["worker_commands"],
    displayName: "Fake Claude stream-json",
    manifestVersion: 3,
    modelCatalogProbe: { kind: "claude-cli/v1" },
    protocolFamily: "rah-worker-process/v1",
    recoveryDrivers:
      process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
    runtimeProfileId: "fake-claude-stream-json",
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
      agentDefinitionRevisionId: "agent-definition-claude-v1",
      contentDigest: `sha256:${"a".repeat(64)}` as const,
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "memory-claude",
        contentDigest: `sha256:${"b".repeat(64)}` as const,
        versionId: "memory-claude-v1",
      },
      skillRefs: [],
    },
    contentDigest: `sha256:${"c".repeat(64)}` as const,
    contextManifestId: `context-claude-${input.suffix}`,
    createdAt: "2026-08-29T08:00:00.000Z",
    eventRanges: [{ fromSeq: 1, toSeq: 1 }],
    participantId: input.participantId,
    placement: {
      placementId: `placement-claude-${input.participantId}`,
      runtimeProfileDigest: input.contentDigest as `sha256:${string}`,
      runtimeProfileRevisionId: input.runtimeProfileRevisionId,
      workspaceDefinitionId: "workspace-claude",
      workspaceMode: "in_place" as const,
      workspaceMountDigest: `sha256:${"d".repeat(64)}` as const,
      workspaceMountRevisionId: "workspace-mount-claude-v1",
    },
    roomId: "room-claude",
    runAttemptId: input.runAttemptId,
    schemaVersion: 1 as const,
    throughRoomSeq: 1,
  };
}

async function waitForRecord(
  recordPath: string,
  activationId: string,
  kind: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    let text = "";
    try {
      text = readFileSync(recordPath, "utf8");
    } catch {
      // The fixture creates the file on first use.
    }
    if (
      text
        .trim()
        .split("\n")
        .filter(Boolean)
        .some((line) => {
          const record = JSON.parse(line);
          return record.activationId === activationId && record.kind === kind;
        })
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${activationId} ${kind}`);
}

const fakeClaude = `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
const recordPath = process.env.FAKE_CLAUDE_RECORD_PATH;
const activationId = process.env.RAH_ACTIVATION_ID;
const record = (value) => recordPath && appendFileSync(recordPath, JSON.stringify({activationId,...value}) + "\\n");
if (args.includes("--version")) { process.stdout.write("2.1.234 (Claude Code)\\n"); process.exit(0); }
if (args.includes("--input-format") && args.includes("stream-json") && !activationId) {
  const rl = createInterface({input:process.stdin});
  rl.on("line", (line) => {
    const frame = JSON.parse(line);
    if (frame.type === "control_request") process.stdout.write(JSON.stringify({
      type:"control_response",response:{request_id:frame.request_id,subtype:"success",response:{models:[{value:"claude-test",supportsFastMode:true,displayName:"Claude Test",description:"test",supportsEffort:true,supportedEffortLevels:["low","high"]},{value:"haiku",displayName:"Haiku (fake)",description:"no effort levels",supportsEffort:false}]}}
    }) + "\\n");
  });
} else {
  const promptPath = args[args.indexOf("--append-system-prompt-file") + 1];
  record({kind:"spawn",args,autoMemoryDisabled:process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY,systemPrompt:readFileSync(promptPath,"utf8")});
  const resumed = args.includes("--resume");
  const missing = activationId?.includes("missing-run") && resumed;
  const cancelled = activationId?.includes("cancel-seed");
  const identityDrift = activationId?.includes("identity-drift-run");
  const toolBeforeInput = activationId?.includes("tool-before-input-run");
  const abnormalSuccess = activationId?.includes("abnormal-success-run");
  const resumedId = args.includes("--resume") ? args[args.indexOf("--resume") + 1] : undefined;
  const sessionId = missing ? resumedId : activationId?.includes("missing-run") ? "claude-session-replacement" : identityDrift ? "claude-session-identity-a" : "claude-session-resumed";
  process.on("SIGINT", () => { record({kind:"signal",signal:"SIGINT"}); process.exit(0); });
  process.on("SIGTERM", () => { record({kind:"signal",signal:"SIGTERM"}); process.exit(0); });
  const rl = createInterface({input:process.stdin});
  rl.once("line", (line) => {
    const input = JSON.parse(line); record({kind:"input",input});
    if (missing) {
      process.stdout.write(JSON.stringify({type:"result",subtype:"error_during_execution",is_error:true,result:"No conversation found",session_id:sessionId}) + "\\n");
      process.exit(1);
      return;
    }
    if (toolBeforeInput) {
      process.stdout.write(JSON.stringify({type:"assistant",session_id:sessionId,message:{content:[{type:"tool_use",id:"tool-early",name:"Bash",input:{command:"should not run"}}]}}) + "\\n");
    }
    process.stdout.write(JSON.stringify({...input,session_id:sessionId}) + "\\n");
    process.stdout.write(JSON.stringify({type:"system",subtype:"init",session_id:identityDrift ? "claude-session-identity-b" : sessionId}) + "\\n");
    if (cancelled) { setInterval(() => {}, 1_000); return; }
    process.stdout.write(JSON.stringify({type:"assistant",session_id:sessionId,message:{content:[{type:"thinking",thinking:"正在读取 Room 状态"},{type:"tool_use",id:"tool-1",name:"Bash",input:{command:"rah worker sync"}}]}}) + "\\n");
    process.stdout.write(JSON.stringify({type:"user",session_id:sessionId,message:{content:[{type:"tool_result",tool_use_id:"tool-1",content:"PRIVATE TOOL OUTPUT"}]}}) + "\\n");
    process.stdout.write(JSON.stringify({type:"assistant",session_id:sessionId,message:{content:[{type:"text",text:"已完成"}]}}) + "\\n");
    process.stdout.write(JSON.stringify({type:"result",subtype:"success",is_error:false,result:"已完成",session_id:sessionId}) + "\\n");
    process.exit(abnormalSuccess ? 2 : 0);
  });
}
`;
