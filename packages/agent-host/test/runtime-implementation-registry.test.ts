import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  ResolvedModel,
  RuntimeProfileManifestV2,
  RuntimeProfileManifestV3,
  ToolAccessMode,
} from "@rah-os/protocol";

import {
  buildRuntimeOfferFromProfile,
  GenericProcessAdapter,
  RuntimeCredentialEnvironmentBinding,
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
} from "../src/index.ts";

function createDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "rah-runtime-factory-"));
  chmodSync(directory, 0o700);
  return directory;
}

function manifest(
  overrides: Partial<RuntimeProfileManifestV2> = {},
): RuntimeProfileManifestV2 {
  return {
    adapter: {
      config: { diagnosticByteLimit: 262_144, terminationGraceMs: 1_000 },
      executable: process.execPath,
      fixedArgs: [
        "-e",
        "process.stdout.write(process.env.PROVIDER_TOKEN ?? 'missing')",
      ],
      kind: "generic-process/v1",
    },
    credentialSlots: [
      {
        slotId: "provider-token",
        target: { kind: "environment", variable: "PROVIDER_TOKEN" },
      },
    ],
    declaredCapabilities: ["worker_commands"],
    displayName: "Fake Node worker",
    manifestVersion: 2,
    protocolFamily: "rah-worker-process/v1",
    recoveryDrivers:
      process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
    runtimeProfileId: "fake-node-worker",
    staticEnv: { PROVIDER_MODE: "plan" },
    workspacePolicy: { allowedModes: ["in_place"] },
    ...overrides,
  };
}

function modelCatalogManifest(executable: string): RuntimeProfileManifestV3 {
  return {
    adapter: {
      config: { diagnosticByteLimit: 262_144, terminationGraceMs: 1_000 },
      executable,
      fixedArgs: ["run", "room-prompt"],
      kind: "generic-process/v1",
    },
    credentialSlots: [],
    declaredCapabilities: ["worker_commands"],
    displayName: "Fake Codex with model catalog",
    manifestVersion: 3,
    modelCatalogProbe: { kind: "codex-cli/v1" },
    protocolFamily: "rah-worker-process/v1",
    recoveryDrivers:
      process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
    runtimeProfileId: "fake-codex-model-catalog",
    staticEnv: {},
    workspacePolicy: { allowedModes: ["in_place"] },
  };
}

function kimiModelCatalogManifest(
  executable: string,
): RuntimeProfileManifestV3 {
  return {
    ...modelCatalogManifest(executable),
    displayName: "Fake Kimi with model catalog",
    modelCatalogProbe: { kind: "kimi-cli/v1" },
    runtimeProfileId: "fake-kimi-model-catalog",
  };
}

function kimiAcpManifest(executable: string): RuntimeProfileManifestV3 {
  return {
    ...kimiModelCatalogManifest(executable),
    adapter: {
      config: { diagnosticByteLimit: 262_144, terminationGraceMs: 1_000 },
      executable,
      fixedArgs: ["canonical room worker prompt"],
      kind: "kimi-acp/v1",
    },
    runtimeProfileId: "fake-kimi-acp",
    staticEnv: {},
  };
}

function codexAppServerManifest(executable: string): RuntimeProfileManifestV3 {
  return {
    ...modelCatalogManifest(executable),
    adapter: {
      config: { diagnosticByteLimit: 262_144, terminationGraceMs: 1_000 },
      executable,
      fixedArgs: ["canonical room worker prompt"],
      kind: "codex-app-server/v1",
    },
    runtimeProfileId: "fake-codex-app-server",
    staticEnv: {},
  };
}

test("Codex app-server implementation drives an unattended policy-bound turn without owning Room state", async () => {
  const directory = createDirectory();
  try {
    const executable = join(directory, "fake-codex-app-server.mjs");
    writeFileSync(
      executable,
      `#!/usr/bin/env node
if (process.argv[2] === "mcp") { process.stdout.write("[]"); process.exit(0); } // FAKE \`codex mcp list --json\`: no user MCP servers
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
if (args.join(" ") === "debug models" || args.join(" ") === "debug models --bundled") {
  process.stdout.write(JSON.stringify({models:[{slug:"gpt-test",visibility:"list",supported_in_api:true,supported_reasoning_levels:[{effort:"low"},{effort:"high"}],service_tiers:[]}]}));
  process.exit(0);
}
if (args[0] !== "app-server" || args.at(-2) !== "--listen" || args.at(-1) !== "stdio://") process.exit(64);
const record = (value) => appendFileSync(process.env.FAKE_CODEX_RECORD_PATH, JSON.stringify(value) + "\\n");
record({activationId:process.env.RAH_ACTIVATION_ID,args});
const rl = createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const approvalResponses = new Set();
let turnRequestId;
rl.on("line", (line) => {
  const frame = JSON.parse(line); record(frame);
  if (frame.method === "initialize") send({jsonrpc:"2.0",id:frame.id,result:{codexHome:process.cwd(),platformFamily:"unix",platformOs:"macos",userAgent:"fake-codex/1"}});
  else if (frame.method === "initialized") {}
  else if (frame.method === "thread/start") send({jsonrpc:"2.0",id:frame.id,result:{thread:{id:"codex-thread-local-only"}}});
  else if (frame.method === "turn/start") {
    turnRequestId = frame.id;
    send({jsonrpc:"2.0",id:frame.id,result:{turn:{id:"turn-1",status:"inProgress"}}});
    send({jsonrpc:"2.0",method:"turn/started",params:{threadId:"codex-thread-local-only",turn:{id:"turn-1",status:"inProgress"}}});
    send({jsonrpc:"2.0",method:"item/started",params:{threadId:"codex-thread-local-only",turnId:"turn-1",item:{id:"command-1",type:"commandExecution",command:"npm test"}}});
    send({jsonrpc:"2.0",method:"item/completed",params:{threadId:"codex-thread-local-only",turnId:"turn-1",item:{id:"reasoning-1",type:"reasoning",summary:["公开推理摘要"],content:["PRIVATE_CHAIN_OF_THOUGHT"]}}});
    send({jsonrpc:"2.0",method:"item/completed",params:{threadId:"codex-thread-local-only",turnId:"turn-1",item:{id:"message-1",type:"agentMessage",text:"canonical reply"}}});
    send({jsonrpc:"2.0",id:701,method:"item/commandExecution/requestApproval",params:{threadId:"codex-thread-local-only",turnId:"turn-1",itemId:"command-1",startedAtMs:1}});
    send({jsonrpc:"2.0",id:702,method:"item/fileChange/requestApproval",params:{threadId:"codex-thread-local-only",turnId:"turn-1",itemId:"patch-1",startedAtMs:2}});
    send({jsonrpc:"2.0",id:703,method:"item/permissions/requestApproval",params:{threadId:"codex-thread-local-only",turnId:"turn-1",itemId:"permissions-1",startedAtMs:3,cwd:process.cwd(),permissions:{network:{enabled:true},fileSystem:{read:[process.cwd()],write:[process.cwd()]},futurePermission:{enabled:true}}}});
  } else if (frame.id === 701 || frame.id === 702 || frame.id === 703) {
    approvalResponses.add(frame.id); record({approvalResponse:frame});
    if (approvalResponses.size === 3) send({jsonrpc:"2.0",method:"turn/completed",params:{threadId:"codex-thread-local-only",turn:{id:"turn-1",status:"completed"}}});
  }
});
`,
      { mode: 0o700 },
    );
    chmodSync(executable, 0o700);
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-codex-app-server",
    });
    profileRegistry.initialize();
    const implementations = new RuntimeImplementationRegistry();
    const revision = profileRegistry.importManifest(
      codexAppServerManifest(executable),
    );
    const report = profileRegistry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: directory }),
    );
    const active = profileRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    const binding =
      report.reportVersion === 2 ? report.modelBindings[0] : undefined;
    assert.notEqual(binding, undefined);
    const runPolicy = async (
      mode: ToolAccessMode | undefined,
      suffix: string,
      custom = false,
    ) => {
      const policyRecordPath = join(directory, `app-server-${suffix}.json`);
      const runtime = implementations.createRuntime(
        active,
        report,
        {
          activationEnvironment: () => ({
            args: ["-c", 'mcp_servers.rah.url="http://127.0.0.1:43111/mcp"'],
            env: {
              FAKE_CODEX_RECORD_PATH: policyRecordPath,
              // No user config.toml: the Human's real MCP list stays out.
              CODEX_HOME: join(directory, "no-user-codex-home"),
            },
          }),
          cwd: directory,
          supervisorDirectory: join(directory, "supervisors"),
        },
        custom
          ? {
              source: "custom_model",
              runtime: "codex",
              modelId: "vendor/custom-gpt-v2",
            }
          : {
              modelBindingId: binding!.modelBindingId,
              modelId: binding!.modelId,
              provider: binding!.provider,
              reasoning: "high",
              source: "explicit_binding",
            },
        mode,
      );
      const trajectory: unknown[] = [];
      const run = await runtime.start(
        {
          activationId: `activation-codex-${suffix}`,
          consumerId: `consumer-codex-${suffix}`,
          fromSeq: 4,
          hostId: "host-codex-app-server",
          participantId: "agent-codex-app-server",
          reason: "manual",
          roomId: "room-codex-app-server",
          runAttemptId: `run-codex-${suffix}`,
          toSeq: 9,
        },
        {
          recordTrajectory: async (activity) => {
            trajectory.push(activity);
          },
          registerPrepared: async () => {},
        },
      );
      assert.equal((await runtime.reap(run)).code, 0);
      return {
        frames: readFileSync(policyRecordPath, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
        trajectory,
      };
    };

    const customRun = await runPolicy("full_access", "custom", true);
    assert.equal(
      customRun.frames.find((frame) => frame.method === "thread/start").params
        .model,
      "vendor/custom-gpt-v2",
    );
    const fullAccess = await runPolicy("full_access", "full-access");
    const frames = fullAccess.frames;
    assert.equal(frames[0].activationId, "activation-codex-full-access");
    assert.deepEqual(frames[0].args, [
      "app-server",
      "-c",
      'mcp_servers.rah.url="http://127.0.0.1:43111/mcp"',
      // Global personal-config isolation (2026-09-26): notify first.
      "-c",
      "notify=[]",
      "-c",
      "features.memories=false",
      "-c",
      "memories.generate_memories=false",
      "-c",
      "memories.use_memories=false",
      "-c",
      "features.goals=false",
      "-c",
      "features.sleep_tool=false",
      "-c",
      "features.in_app_local_automation=false",
      "-c",
      "features.plugins=false",
      "-c",
      "features.apps=false",
      "-c",
      "features.hooks=false",
      "-c",
      "skills.include_instructions=false",
      "-c",
      'web_search="disabled"',
      "--listen",
      "stdio://",
    ]);
    const threadStart = frames.find((frame) => frame.method === "thread/start");
    assert.equal(threadStart.params.approvalPolicy, "never");
    assert.equal(threadStart.params.sandbox, "danger-full-access");
    assert.equal(threadStart.params.model, "gpt-test");
    assert.equal(threadStart.params.config.model_reasoning_effort, "high");
    assert.equal(
      threadStart.params.developerInstructions,
      "canonical room worker prompt",
    );
    const turnStart = frames.find((frame) => frame.method === "turn/start");
    assert.equal(turnStart.params.threadId, "codex-thread-local-only");
    assert.equal(turnStart.params.effort, "high");
    const approvalResponses = frames
      .filter((frame) => frame.approvalResponse !== undefined)
      .map((frame) => frame.approvalResponse);
    assert.deepEqual(
      approvalResponses.find((frame) => frame.id === 701).result,
      { decision: "accept" },
    );
    assert.deepEqual(
      approvalResponses.find((frame) => frame.id === 702).result,
      { decision: "accept" },
    );
    assert.deepEqual(
      approvalResponses.find((frame) => frame.id === 703).result,
      {
        permissions: {
          fileSystem: {
            read: [realpathSync(directory)],
            write: [realpathSync(directory)],
          },
          network: { enabled: true },
        },
        scope: "turn",
      },
    );
    assert.match(JSON.stringify(fullAccess.trajectory), /公开推理摘要/u);
    assert.match(JSON.stringify(fullAccess.trajectory), /canonical reply/u);
    assert.doesNotMatch(
      JSON.stringify(fullAccess.trajectory),
      /PRIVATE_CHAIN_OF_THOUGHT/u,
    );
    assert.deepEqual(
      fullAccess.trajectory.map((activity: any) => activity.producerSequence),
      [...Array(fullAccess.trajectory.length)].map((_, index) => index + 1),
    );

    const defaultFrames = (await runPolicy(undefined, "raft-default")).frames;
    const defaultThreadStart = defaultFrames.find(
      (frame) => frame.method === "thread/start",
    );
    assert.equal(defaultThreadStart.params.approvalPolicy, "never");
    assert.equal(defaultThreadStart.params.sandbox, "danger-full-access");
    const defaultApprovals = defaultFrames
      .filter((frame) => frame.approvalResponse !== undefined)
      .map((frame) => frame.approvalResponse);
    assert.deepEqual(
      defaultApprovals.find((frame) => frame.id === 701).result,
      { decision: "accept" },
    );
    assert.deepEqual(
      defaultApprovals.find((frame) => frame.id === 702).result,
      { decision: "accept" },
    );
    assert.deepEqual(
      defaultApprovals.find((frame) => frame.id === 703).result,
      {
        permissions: {
          fileSystem: {
            read: [realpathSync(directory)],
            write: [realpathSync(directory)],
          },
          network: { enabled: true },
        },
        scope: "turn",
      },
    );

    await assert.rejects(
      runPolicy("read_only", "read-only"),
      /standard Raft policy requires full_access/u,
    );
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Kimi ACP implementation drives model, effort, permission, and terminal RPC without owning Room state", async () => {
  const directory = createDirectory();
  try {
    const executable = join(directory, "fake-kimi-acp.mjs");
    const recordPath = join(directory, "acp-record.json");
    const mcpConfigPath = join(directory, "mcp.json");
    writeFileSync(
      mcpConfigPath,
      JSON.stringify({
        mcpServers: {
          rah_managed: {
            transport: "http",
            url: "http://127.0.0.1:3456/mcp",
          },
        },
      }),
      { mode: 0o600 },
    );
    writeFileSync(
      executable,
      `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const record = (value) => appendFileSync(process.env.FAKE_ACP_RECORD_PATH, JSON.stringify(value) + "\\n");
if (process.argv.slice(2).join(" ") === "provider list --json") {
  process.stdout.write(JSON.stringify({models:{"kimi-code/k3":{defaultEffort:"high",displayName:"K3",provider:"managed:kimi-code",supportEfforts:["low","high","max"]}},providers:{}}));
  process.exit(0);
}
if (process.argv[2] !== "acp") process.exit(64);
const rl = createInterface({ input: process.stdin });
let sessionId = "";
let promptRequestId = null;
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
rl.on("line", (line) => {
  const frame = JSON.parse(line); record(frame);
  if (frame.method === "initialize") send({jsonrpc:"2.0",id:frame.id,result:{protocolVersion:1,agentCapabilities:{mcpCapabilities:{http:true,sse:false}}}});
  else if (frame.method === "session/new") { sessionId = "acp-local-only"; send({jsonrpc:"2.0",id:frame.id,result:{sessionId}}); }
  else if (frame.method === "session/set_model") send({jsonrpc:"2.0",id:frame.id,result:{} });
  else if (frame.method === "session/set_config_option") send({jsonrpc:"2.0",id:frame.id,result:{configOptions:[{id:frame.params.configId,currentValue:frame.params.value}]}});
  else if (frame.method === "session/prompt") {
    promptRequestId = frame.id;
    send({jsonrpc:"2.0",method:"session/update",params:{sessionId,update:{sessionUpdate:"agent_thought_chunk",messageId:"thought-1",content:{type:"text",text:"分析任务"}}}});
    send({jsonrpc:"2.0",method:"session/update",params:{sessionId,update:{sessionUpdate:"tool_call",toolCallId:"tool-1",title:"运行测试",status:"in_progress",rawInput:{command:"npm test"}}}});
    send({jsonrpc:"2.0",method:"session/update",params:{sessionId,update:{sessionUpdate:"agent_message_chunk",messageId:"message-1",content:{type:"text",text:"Kimi canonical reply"}}}});
    send({jsonrpc:"2.0",id:"permission-1",method:"session/request_permission",params:{sessionId,options:[{optionId:"persist",kind:"allow_always"},{optionId:"once",kind:"allow_once"},{optionId:"reject",kind:"reject_once"}]}});
  }
  else if (frame.id === "permission-1") send({jsonrpc:"2.0",id:"terminal-create-1",method:"terminal/create",params:{sessionId,command:process.execPath,args:["-e","const e=process.env;process.stdout.write([e.RAH_ACTIVATION_ID,e.LOOM_RUN_ID,String(e.LOOM_RUNTIME_ID).startsWith('process:')?'tagged':e.LOOM_RUNTIME_ID].join('|'))"],env:[{name:"LOOM_RUNTIME_ID",value:"forged"}]}});
  else if (frame.id === "terminal-create-1") send({jsonrpc:"2.0",id:"terminal-wait-1",method:"terminal/wait_for_exit",params:{sessionId,terminalId:frame.result.terminalId}});
  else if (frame.id === "terminal-wait-1") send({jsonrpc:"2.0",id:"terminal-output-1",method:"terminal/output",params:{sessionId,terminalId:"rah-acp-terminal-1"}});
  else if (frame.id === "terminal-output-1") { record({terminalOutput:frame.result.output}); send({jsonrpc:"2.0",id:promptRequestId,result:{stopReason:"end_turn"}}); }
});
`,
      { mode: 0o700 },
    );
    chmodSync(executable, 0o700);
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-kimi-acp",
    });
    profileRegistry.initialize();
    const implementations = new RuntimeImplementationRegistry();
    const revision = profileRegistry.importManifest(
      kimiAcpManifest(executable),
    );
    const report = profileRegistry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: directory }),
    );
    const active = profileRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    const binding =
      report.reportVersion === 2 ? report.modelBindings[0] : undefined;
    assert.notEqual(binding, undefined);
    assert.throws(
      () =>
        implementations.createRuntime(
          active,
          report,
          {
            cwd: directory,
            supervisorDirectory: join(directory, "restricted-supervisors"),
          },
          undefined,
          "read_only",
        ),
      /restricted execution fails closed/u,
    );
    const runtime = implementations.createRuntime(
      active,
      report,
      {
        activationEnvironment: () => ({
          args: ["--mcp-config-file", mcpConfigPath],
          env: { FAKE_ACP_RECORD_PATH: recordPath },
        }),
        cwd: directory,
        supervisorDirectory: join(directory, "supervisors"),
      },
      {
        modelBindingId: binding!.modelBindingId,
        modelId: binding!.modelId,
        provider: binding!.provider,
        reasoning: "max",
        source: "explicit_binding",
      },
      "full_access",
    );
    const trajectory: unknown[] = [];
    const run = await runtime.start(
      {
        activationId: "activation-kimi-acp",
        consumerId: "consumer-kimi-acp",
        fromSeq: 3,
        hostId: "host-kimi-acp",
        participantId: "agent-kimi-acp",
        reason: "manual",
        roomId: "room-kimi-acp",
        runAttemptId: "run-kimi-acp",
        toSeq: 7,
      },
      {
        recordTrajectory: async (activity) => {
          trajectory.push(activity);
        },
        registerPrepared: async () => {},
      },
    );
    assert.equal((await runtime.reap(run)).code, 0);
    const frames = readFileSync(recordPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(
      frames.find((frame) => frame.method === "session/new").params.cwd,
      realpathSync(directory),
    );
    assert.deepEqual(
      frames.find((frame) => frame.method === "session/new").params.mcpServers,
      [
        {
          headers: [],
          name: "rah_managed",
          type: "http",
          url: "http://127.0.0.1:3456/mcp",
        },
      ],
    );
    assert.equal(
      frames.find((frame) => frame.method === "session/set_model").params
        .modelId,
      "kimi-code/k3",
    );
    assert.equal(
      frames.find((frame) => frame.method === "session/set_config_option")
        .params.value,
      "max",
    );
    assert.deepEqual(
      frames.find((frame) => frame.id === "permission-1").result,
      {
        outcome: { optionId: "once", outcome: "selected" },
      },
    );
    assert.equal(
      frames.find((frame) => frame.terminalOutput !== undefined).terminalOutput,
      // S2-0: ACP terminals keep the Host tags; a provider env cannot forge them.
      "activation-kimi-acp|run-kimi-acp|tagged",
    );
    assert.match(JSON.stringify(trajectory), /分析任务/u);
    assert.match(JSON.stringify(trajectory), /运行测试/u);
    assert.match(JSON.stringify(trajectory), /Kimi canonical reply/u);
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a v3 model catalog probe drives the exact argv selected by Placement", async () => {
  const directory = createDirectory();
  try {
    const executable = join(directory, "fake-codex.mjs");
    writeFileSync(
      executable,
      `#!/usr/bin/env node
if (process.argv.slice(2).join(" ") === "debug models --bundled") {
  process.stdout.write(JSON.stringify({models:[{slug:"gpt-test",visibility:"list",supported_in_api:true,supported_reasoning_levels:[{effort:"high"}],service_tiers:[]}]}));
} else {
  process.stdout.write(JSON.stringify(process.argv.slice(2)));
}
`,
      { mode: 0o700 },
    );
    chmodSync(executable, 0o700);
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-model-catalog",
    });
    profileRegistry.initialize();
    const revision = profileRegistry.importManifest(
      modelCatalogManifest(executable),
    );
    const implementations = new RuntimeImplementationRegistry();
    const report = profileRegistry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: directory }),
    );
    assert.equal(report.reportVersion, 2);
    assert.equal(report.modelBindings[0]?.modelId, "gpt-test");
    const active = profileRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    const binding = report.modelBindings[0]!;
    const resolvedModel = {
      modelBindingId: binding.modelBindingId,
      modelId: binding.modelId,
      provider: binding.provider,
      reasoning: "high",
      source: "explicit_binding",
    } satisfies ResolvedModel;
    const runtime = implementations.createRuntime(
      active,
      report,
      { cwd: directory, supervisorDirectory: join(directory, "supervisors") },
      resolvedModel,
      "full_access",
    );
    let prepared = false;
    const run = await runtime.start(
      {
        activationId: "activation-model-catalog",
        consumerId: "consumer-model-catalog",
        fromSeq: 1,
        hostId: "host-model-catalog",
        participantId: "agent-model-catalog",
        reason: "manual",
        roomId: "room-model-catalog",
        runAttemptId: "run-attempt-model-catalog",
        toSeq: 1,
      },
      {
        registerPrepared: async () => {
          prepared = true;
        },
      },
    );
    assert.equal(prepared, true);
    assert.equal((await runtime.reap(run)).code, 0);
    assert.deepEqual(JSON.parse(runtime.diagnostics(run).stdout), [
      "--model",
      "gpt-test",
      "--config",
      "model_reasoning_effort=high",
      "--sandbox",
      "danger-full-access",
      "run",
      "room-prompt",
    ]);
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Kimi Placement effort reaches the CLI through its native process environment", async () => {
  const directory = createDirectory();
  try {
    const executable = join(directory, "fake-kimi.mjs");
    writeFileSync(
      executable,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.join(" ") === "provider list --json") {
  process.stdout.write(JSON.stringify({models:{"kimi-code/k3":{defaultEffort:"high",displayName:"K3",provider:"managed:kimi-code",supportEfforts:["low","high","max"]}},providers:{}}));
} else {
  process.stdout.write(JSON.stringify({args,effort:process.env.KIMI_MODEL_THINKING_EFFORT}));
}
`,
      { mode: 0o700 },
    );
    chmodSync(executable, 0o700);
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-kimi-model-catalog",
    });
    profileRegistry.initialize();
    const revision = profileRegistry.importManifest(
      kimiModelCatalogManifest(executable),
    );
    const implementations = new RuntimeImplementationRegistry();
    const report = profileRegistry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: directory }),
    );
    assert.equal(report.reportVersion, 2);
    const active = profileRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    const binding = report.modelBindings[0]!;
    const runtime = implementations.createRuntime(
      active,
      report,
      { cwd: directory, supervisorDirectory: join(directory, "supervisors") },
      {
        modelBindingId: binding.modelBindingId,
        modelId: binding.modelId,
        provider: binding.provider,
        reasoning: "max",
        source: "explicit_binding",
      },
      "full_access",
    );
    const run = await runtime.start(
      {
        activationId: "activation-kimi-model-catalog",
        consumerId: "consumer-kimi-model-catalog",
        fromSeq: 1,
        hostId: "host-kimi-model-catalog",
        participantId: "agent-kimi-model-catalog",
        reason: "manual",
        roomId: "room-kimi-model-catalog",
        runAttemptId: "run-attempt-kimi-model-catalog",
        toSeq: 1,
      },
      { registerPrepared: async () => {} },
    );
    assert.equal((await runtime.reap(run)).code, 0);
    assert.deepEqual(JSON.parse(runtime.diagnostics(run).stdout), {
      args: ["--model", "kimi-code/k3", "--yolo", "run", "room-prompt"],
      effort: "max",
    });
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a failed optional model catalog degrades to provider default without disabling the runtime", async () => {
  const directory = createDirectory();
  try {
    const executable = join(directory, "fake-catalog-failure.mjs");
    writeFileSync(
      executable,
      `#!/usr/bin/env node
process.stderr.write("catalog temporarily unavailable\\n");
process.exitCode = 1;
`,
      { mode: 0o700 },
    );
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-catalog-fallback",
    });
    profileRegistry.initialize();
    const revision = profileRegistry.importManifest(
      modelCatalogManifest(executable),
    );
    const implementations = new RuntimeImplementationRegistry();
    const report = profileRegistry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: directory }),
    );
    assert.equal(report.available, true);
    assert.equal(report.failureCode, undefined);
    assert.equal(report.reportVersion, 2);
    if (report.reportVersion !== 2) throw new Error("expected v2 probe");
    assert.deepEqual(report.modelBindings, []);
    assert.doesNotThrow(() =>
      profileRegistry.activateRevision({
        contentDigest: revision.contentDigest,
        runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
      }),
    );
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("built-in runtime implementations produce profile-bound immutable probe evidence", async () => {
  const directory = createDirectory();
  try {
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-runtime-factory",
    });
    profileRegistry.initialize();
    const revision = profileRegistry.importManifest(manifest());
    const implementations = new RuntimeImplementationRegistry();
    assert.equal(
      implementations.adapterImplementationVersion("generic-process/v1"),
      "generic-process-adapter/v1",
    );
    assert.equal(
      implementations.adapterImplementationVersion("pi-print-json/v1"),
      "pi-print-json-driver/v1",
    );
    assert.equal(
      implementations.adapterImplementationVersion("unknown-adapter/v1"),
      undefined,
    );
    assert.equal(
      implementations.recoveryDriverImplementationVersion(
        "unknown-recovery-driver/v1",
      ),
      undefined,
    );
    const observation = await implementations.probeRevision(revision, {
      cwd: directory,
    });
    assert.equal(observation.available, true);
    assert.equal(observation.adapter.kind, "generic-process/v1");
    assert.equal(
      observation.executableIdentity?.requestedExecutable,
      process.execPath,
    );
    assert.match(
      observation.executableIdentity?.contentDigest ?? "",
      /^sha256:[a-f0-9]{64}$/,
    );

    const report = profileRegistry.recordProbeReport(observation);
    assert.equal(report.runtimeProfileDigest, revision.contentDigest);
    const active = profileRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    if (process.platform !== "win32") {
      const recoveryRuntime = implementations.createRecoveryRuntime(
        active,
        "rah-process-supervisor-v1",
        { cwd: directory, supervisorDirectory: join(directory, "supervisors") },
      );
      assert.equal(typeof recoveryRuntime.recover, "function");
      assert.throws(
        () =>
          implementations.createRecoveryRuntime(
            active,
            "unknown-recovery-driver/v1",
            { cwd: directory },
          ),
        /unsupported runtime recovery driver/,
      );
    }
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("unknown recovery drivers fail closed instead of becoming an offer", async () => {
  const directory = createDirectory();
  try {
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-unknown-driver",
    });
    profileRegistry.initialize();
    const revision = profileRegistry.importManifest(
      manifest({ recoveryDrivers: ["unknown-recovery-driver/v1"] }),
    );
    const observation = await new RuntimeImplementationRegistry().probeRevision(
      revision,
      { cwd: directory },
    );
    assert.equal(observation.available, false);
    assert.equal(observation.failureCode, "recovery_driver_unavailable");
    profileRegistry.recordProbeReport(observation);
    assert.throws(
      () =>
        profileRegistry.activateRevision({
          contentDigest: revision.contentDigest,
          runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
        }),
      /latest probe report is not successful/,
    );
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("credential slots resolve only before spawn and are redacted from diagnostics", async () => {
  const directory = createDirectory();
  const secret = "provider-secret-that-must-be-redacted";
  try {
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-secret-binding",
    });
    profileRegistry.initialize();
    const revision = profileRegistry.importManifest(manifest());
    const implementations = new RuntimeImplementationRegistry();
    const probeReport = profileRegistry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: directory }),
    );
    profileRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    const activeRevision = profileRegistry.getActiveRevision(
      revision.runtimeProfileId,
    );
    assert.ok(activeRevision);

    let resolutions = 0;
    const credentials = new RuntimeCredentialEnvironmentBinding({
      manifest: activeRevision.manifest,
      resolvers: {
        "provider-token": async () => {
          resolutions += 1;
          return secret;
        },
      },
    });
    const runtime = implementations.createRuntime(activeRevision, probeReport, {
      activationEnvironment: async () => await credentials.resolve(),
      cwd: directory,
      supervisorDirectory: join(directory, "supervisors"),
    });
    assert.ok(runtime instanceof GenericProcessAdapter);
    assert.equal(resolutions, 0);

    const handle = await runtime.start(
      {
        activationId: "activation-secret",
        consumerId: "consumer-secret",
        fromSeq: 1,
        hostId: "host-secret-binding",
        participantId: "participant-secret",
        reason: "manual",
        roomId: "room-secret",
        runAttemptId: "run-secret",
        toSeq: 1,
      },
      { registerPrepared: async () => undefined },
    );
    assert.equal(resolutions, 1);
    if (process.platform !== "win32") {
      assert.deepEqual(
        {
          recoveryImplementationVersion:
            handle.recoveryDescriptor?.recoveryImplementationVersion,
          runtimeProfileDigest: handle.recoveryDescriptor?.runtimeProfileDigest,
          runtimeProfileRevisionId:
            handle.recoveryDescriptor?.runtimeProfileRevisionId,
        },
        {
          recoveryImplementationVersion: "rah-process-supervisor/v1",
          runtimeProfileDigest: activeRevision.contentDigest,
          runtimeProfileRevisionId: activeRevision.runtimeProfileRevisionId,
        },
      );
    }
    assert.equal((await runtime.reap(handle)).code, 0);
    const diagnostics = runtime.diagnostics(handle);
    assert.equal(diagnostics.stdout.includes(secret), false);
    assert.match(diagnostics.stdout, /\[REDACTED\]/);
    runtime.release(handle);
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("credential bindings reject missing and extra slots before runtime creation", () => {
  assert.throws(
    () =>
      new RuntimeCredentialEnvironmentBinding({
        manifest: manifest(),
        resolvers: {},
      }),
    /missing credential slot provider-token/,
  );
  assert.throws(
    () =>
      new RuntimeCredentialEnvironmentBinding({
        manifest: manifest({ credentialSlots: [] }),
        resolvers: { unexpected: async () => "secret" },
      }),
    /unknown credential slot unexpected/,
  );
  assert.throws(
    () =>
      new RuntimeCredentialEnvironmentBinding({
        manifest: manifest({
          credentialSlots: [
            {
              slotId: "toString",
              target: { kind: "environment", variable: "PROVIDER_TOKEN" },
            },
          ],
        }),
        resolvers: {},
      }),
    /missing credential slot toString/,
  );
});

test("credential bindings reject secrets too large for bounded diagnostic redaction", async () => {
  const credentials = new RuntimeCredentialEnvironmentBinding({
    manifest: manifest(),
    resolvers: {
      "provider-token": async () => "x".repeat(65_537),
    },
  });
  await assert.rejects(credentials.resolve(), /safe byte limit/);
});

test("active profile projection exposes only a probe reference and redacted descriptors", async () => {
  const directory = createDirectory();
  try {
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-offer",
    });
    profileRegistry.initialize();
    const revision = profileRegistry.importManifest(manifest());
    const implementations = new RuntimeImplementationRegistry();
    const report = profileRegistry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: directory }),
    );
    const active = profileRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    const offer = buildRuntimeOfferFromProfile({
      hostId: "host-offer",
      hostInstanceId: "host-instance-offer",
      leaseUntil: "2026-08-26T00:02:00.000Z",
      maxConcurrent: 1,
      observedAt: "2026-08-26T00:00:00.000Z",
      probeReport: report,
      runtimeOfferId: "runtime-offer-main",
      runtimeProfileRevision: active,
      state: "available",
      workspaceMountDescriptors: [
        {
          modes: ["in_place"],
          workspaceDefinitionId: "workspace-offer",
          workspaceMountDigest: `sha256:${"a".repeat(64)}`,
          workspaceMountRevisionId: "workspace-mount-offer-v1",
        },
      ],
    });
    assert.deepEqual(offer.probeReportRef, {
      probeDigest: report.probeDigest,
      probeReportId: report.probeReportId,
    });
    assert.deepEqual(offer.capabilityEvidence, [
      { capability: "worker_commands", evidence: "declared" },
    ]);
    assert.deepEqual(offer.workspaceMountDescriptors, [
      {
        modes: ["in_place"],
        workspaceDefinitionId: "workspace-offer",
        workspaceMountDigest: `sha256:${"a".repeat(64)}`,
        workspaceMountRevisionId: "workspace-mount-offer-v1",
      },
    ]);
    assert.deepEqual(
      offer.supportedToolAccessModes,
      ["full_access"],
      "a legacy generic profile without a verified Provider mapping must not claim restricted execution",
    );
    assert.throws(
      () =>
        buildRuntimeOfferFromProfile({
          hostId: "host-offer",
          hostInstanceId: "host-instance-offer",
          leaseUntil: "2026-08-26T00:02:00.000Z",
          maxConcurrent: 1,
          observedAt: "2026-08-26T00:00:00.000Z",
          probeReport: report,
          runtimeOfferId: "runtime-offer-invalid-workspace",
          runtimeProfileRevision: active,
          state: "available",
          workspaceMountDescriptors: [
            {
              modes: ["worktree"],
              workspaceDefinitionId: "workspace-offer",
              workspaceMountDigest: `sha256:${"b".repeat(64)}`,
              workspaceMountRevisionId: "workspace-mount-offer-v2",
            },
          ],
        }),
      /does not allow workspace mode worktree/,
    );
    const serialized = JSON.stringify(offer);
    assert.equal(serialized.includes(process.execPath), false);
    assert.equal(serialized.includes("provider-token"), false);
    assert.equal(serialized.includes("PROVIDER_MODE"), false);
    assert.equal(serialized.includes("resolvedExecutablePath"), false);
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a newer failed probe fences activation even when an older probe succeeded", async () => {
  if (process.platform === "win32") return;
  const directory = createDirectory();
  try {
    const executablePath = join(directory, "temporary-worker");
    writeFileSync(executablePath, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-probe-fence",
    });
    profileRegistry.initialize();
    const revision = profileRegistry.importManifest(
      manifest({
        adapter: {
          ...manifest().adapter,
          executable: executablePath,
          fixedArgs: [],
        },
      }),
    );
    const implementations = new RuntimeImplementationRegistry();
    const successful = await implementations.probeRevision(revision, {
      cwd: directory,
    });
    assert.equal(successful.available, true);
    profileRegistry.recordProbeReport(successful);
    profileRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });

    rmSync(executablePath);
    const failed = await implementations.probeRevision(revision, {
      cwd: directory,
    });
    assert.equal(failed.available, false);
    profileRegistry.recordProbeReport(failed);
    assert.throws(
      () =>
        profileRegistry.activateRevision({
          contentDigest: revision.contentDigest,
          runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
        }),
      /latest probe report is not successful/,
    );
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("probe rejects a manifest snapshot that no longer matches its immutable revision digest", async () => {
  const directory = createDirectory();
  try {
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-tampered-probe",
    });
    profileRegistry.initialize();
    const revision = profileRegistry.importManifest(
      manifest({ staticEnv: { PATH: join(directory, "missing-bin") } }),
    );
    const tampered = structuredClone(revision);
    assert.equal(tampered.manifest.manifestVersion, 2);
    tampered.manifest.staticEnv.PATH = process.env.PATH ?? "";
    await assert.rejects(
      new RuntimeImplementationRegistry().probeRevision(tampered, {
        cwd: directory,
      }),
      /manifest digest does not match immutable revision/,
    );
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("spawn revalidates executable identity before loading credentials or preparing a run", async () => {
  if (process.platform === "win32") return;
  const directory = createDirectory();
  try {
    const executablePath = join(directory, "replaceable-worker");
    writeFileSync(executablePath, "#!/bin/sh\necho ORIGINAL\n", {
      mode: 0o700,
    });
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-spawn-fence",
    });
    profileRegistry.initialize();
    const revision = profileRegistry.importManifest(
      manifest({
        adapter: {
          ...manifest().adapter,
          executable: executablePath,
          fixedArgs: [],
        },
      }),
    );
    const implementations = new RuntimeImplementationRegistry();
    const report = profileRegistry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: directory }),
    );
    const active = profileRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    let credentialLoads = 0;
    let preparedRuns = 0;
    const runtime = implementations.createRuntime(active, report, {
      activationEnvironment: async () => {
        credentialLoads += 1;
        return { env: { PROVIDER_TOKEN: "not-loaded" } };
      },
      cwd: directory,
      supervisorDirectory: join(directory, "supervisors"),
    });

    writeFileSync(executablePath, "#!/bin/sh\necho REPLACED\n", {
      mode: 0o700,
    });
    await assert.rejects(
      runtime.start(
        {
          activationId: "activation-spawn-fence",
          consumerId: "consumer-spawn-fence",
          fromSeq: 1,
          hostId: "host-spawn-fence",
          participantId: "participant-spawn-fence",
          reason: "manual",
          roomId: "room-spawn-fence",
          runAttemptId: "run-spawn-fence",
          toSeq: 1,
        },
        {
          registerPrepared: async () => {
            preparedRuns += 1;
          },
        },
      ),
      /executable identity changed after probe/,
    );
    assert.equal(credentialLoads, 0);
    assert.equal(preparedRuns, 0);
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the process supervisor revalidates executable identity after credential loading and before target launch", async () => {
  if (process.platform === "win32") return;
  const directory = createDirectory();
  try {
    const executablePath = join(directory, "launch-race-worker");
    writeFileSync(executablePath, "#!/bin/sh\necho ORIGINAL_A\n", {
      mode: 0o700,
    });
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-launch-race",
    });
    profileRegistry.initialize();
    const revision = profileRegistry.importManifest(
      manifest({
        adapter: {
          ...manifest().adapter,
          executable: executablePath,
          fixedArgs: [],
        },
        credentialSlots: [],
      }),
    );
    const implementations = new RuntimeImplementationRegistry();
    const report = profileRegistry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: directory }),
    );
    const active = profileRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    const runtime = implementations.createRuntime(active, report, {
      activationEnvironment: async () => {
        writeFileSync(executablePath, "#!/bin/sh\necho REPLACED_B\n", {
          mode: 0o700,
        });
        return { env: {} };
      },
      cwd: directory,
      supervisorDirectory: join(directory, "supervisors"),
    });
    let prepared:
      Awaited<ReturnType<GenericProcessAdapter["start"]>> | undefined;
    await assert.rejects(
      runtime.start(
        {
          activationId: "activation-launch-race",
          consumerId: "consumer-launch-race",
          fromSeq: 1,
          hostId: "host-launch-race",
          participantId: "participant-launch-race",
          reason: "manual",
          roomId: "room-launch-race",
          runAttemptId: "run-launch-race",
          toSeq: 1,
        },
        {
          registerPrepared: async (candidate) => {
            prepared = candidate;
          },
        },
      ),
      /executable identity changed after probe/,
    );
    assert.ok(prepared);
    assert.equal(
      runtime.diagnostics(prepared).stdout.includes("REPLACED_B"),
      false,
    );
    assert.deepEqual(await runtime.reap(prepared), {
      code: null,
      signal: "RAH_START_FAILED",
    });
    assert.ok(prepared.recoveryDescriptor);
    const recoveringRuntime = implementations.createRecoveryRuntime(
      active,
      prepared.recoveryDescriptor.driver,
      { cwd: directory, supervisorDirectory: join(directory, "supervisors") },
    );
    assert.deepEqual(
      await recoveringRuntime.recover!({
        recoveryDescriptor: prepared.recoveryDescriptor,
        runAttemptId: "run-launch-race",
        runtimeRunId: prepared.runId,
      }),
      { code: null, signal: "RAH_START_FAILED" },
    );
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a frozen runtime refuses future launches after its profile active revision changes", async () => {
  const directory = createDirectory();
  try {
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-profile-lifecycle-fence",
    });
    profileRegistry.initialize();
    const implementations = new RuntimeImplementationRegistry();
    const original = profileRegistry.importManifest(
      manifest({ credentialSlots: [] }),
    );
    const originalReport = profileRegistry.recordProbeReport(
      await implementations.probeRevision(original, { cwd: directory }),
    );
    const activeOriginal = profileRegistry.activateRevision({
      contentDigest: original.contentDigest,
      runtimeProfileRevisionId: original.runtimeProfileRevisionId,
    });
    const runtime = implementations.createRuntime(
      activeOriginal,
      originalReport,
      {
        beforeStart: () => {
          const current = profileRegistry.getActiveRevision(
            activeOriginal.runtimeProfileId,
          );
          if (
            current?.runtimeProfileRevisionId !==
              activeOriginal.runtimeProfileRevisionId ||
            current.contentDigest !== activeOriginal.contentDigest
          ) {
            throw new Error("runtime profile active revision changed");
          }
        },
        cwd: directory,
        supervisorDirectory: join(directory, "supervisors"),
      },
    );
    const replacement = profileRegistry.importManifest(
      manifest({
        credentialSlots: [],
        displayName: "Replacement Node worker",
      }),
    );
    profileRegistry.recordProbeReport(
      await implementations.probeRevision(replacement, { cwd: directory }),
    );
    profileRegistry.activateRevision({
      contentDigest: replacement.contentDigest,
      runtimeProfileRevisionId: replacement.runtimeProfileRevisionId,
    });

    assert.deepEqual(await runtime.probe(), {
      available: false,
      detail: "runtime profile active revision changed",
    });
    let preparedRuns = 0;
    await assert.rejects(
      runtime.start(
        {
          activationId: "activation-lifecycle-fence",
          consumerId: "consumer-lifecycle-fence",
          fromSeq: 1,
          hostId: "host-profile-lifecycle-fence",
          participantId: "participant-lifecycle-fence",
          reason: "manual",
          roomId: "room-lifecycle-fence",
          runAttemptId: "run-lifecycle-fence",
          toSeq: 1,
        },
        {
          registerPrepared: async () => {
            preparedRuns += 1;
          },
        },
      ),
      /runtime profile active revision changed/,
    );
    assert.equal(preparedRuns, 0);
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
