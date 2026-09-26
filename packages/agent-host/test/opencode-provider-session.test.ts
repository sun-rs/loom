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

test("OpenCode native server resumes sessions, auto-authorizes, recovers 404, and aborts before kill", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-opencode-provider-session-"),
  );
  chmodSync(directory, 0o700);
  try {
    const executable = join(directory, "fake-opencode-server.mjs");
    const recordPath = join(directory, "opencode-record.jsonl");
    writeFileSync(executable, fakeOpenCodeServer, { mode: 0o700 });
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-opencode",
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
            FAKE_OPENCODE_RECORD_PATH: recordPath,
            RAH_REQUIRE_SESSION_CONTINUITY: strictContinuity ? "1" : "0",
          },
          standingPromptDigest: "sha256-standing-prompt-digest",
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
        reasoning: "max",
        source: "explicit_binding",
      },
      "full_access",
    );
    const trajectory: unknown[] = [];
    const runActivation = async (
      scenario: string,
      phase: "seed" | "run",
      completion: "cancel" | "reap" = "reap",
    ) => {
      const suffix = `${scenario}-${phase}`;
      const activationId = `activation-opencode-${suffix}`;
      const participantId = `agent-opencode-${scenario}`;
      const runAttemptId = `run-opencode-${suffix}`;
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
          hostId: "host-opencode",
          participantId,
          reason: "manual",
          roomId: "room-opencode",
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
        await waitForRecordedPath(recordPath, activationId, "/message");
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
    assert.equal((await runActivation("resumed", "run")).code, 0);
    assert.equal((await runActivation("missing", "seed")).code, 0);
    assert.equal((await runActivation("missing", "run")).code, 0);
    assert.equal((await runActivation("cancel", "seed", "cancel")).code, 0);
    assert.equal((await runActivation("cancel", "run")).code, 0);

    const records = readFileSync(recordPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(
      records.filter(
        (r) =>
          r.activationId === "activation-opencode-strict-missing-run" &&
          r.method === "POST" &&
          r.path === "/session",
      ).length,
      0,
      "no fresh session after failed resume",
    );
    const forActivation = (suffix: string) =>
      records.filter(
        (record) => record.activationId === `activation-opencode-${suffix}`,
      );
    assert.equal(
      forActivation("resumed-seed").some(
        (record) => record.method === "POST" && record.path === "/session",
      ),
      true,
    );
    assert.equal(
      forActivation("resumed-run").some(
        (record) =>
          record.method === "GET" &&
          record.path === "/session/opencode-session-resumed",
      ),
      true,
    );
    assert.equal(
      forActivation("resumed-run").some(
        (record) => record.method === "POST" && record.path === "/session",
      ),
      false,
    );
    assert.deepEqual(
      forActivation("missing-run")
        .filter((record) => record.method === "POST")
        .map((record) => record.path)
        .filter((path) => path === "/session" || path.endsWith("/message")),
      ["/session", "/session/opencode-session-replacement/message"],
    );
    const create = forActivation("resumed-seed").find(
      (record) => record.method === "POST" && record.path === "/session",
    );
    // evo §40 B2: allow all, then deny question and plan mode.
    assert.deepEqual(create.body.permission, [
      { action: "allow", pattern: "*", permission: "*" },
      { action: "deny", pattern: "*", permission: "question" },
      { action: "deny", pattern: "*", permission: "plan_enter" },
      { action: "deny", pattern: "*", permission: "plan_exit" },
    ]);
    assert.deepEqual(JSON.parse(create.permissionEnv), { "*": "allow" });
    const prompt = forActivation("resumed-seed").find(
      (record) =>
        typeof record.path === "string" && record.path.endsWith("/message"),
    );
    assert.deepEqual(prompt.body.model, {
      modelID: "deepseek-v4-flash",
      providerID: "deepseek",
    });
    assert.equal(prompt.body.variant, "max");
    // S2-c3: the standing prompt is the server's `instructions` file (system
    // layer of every model request, compaction included), never a
    // per-message `system`.
    assert.equal(prompt.body.system, undefined);
    assert.match(prompt.body.messageID, /^msg_/u);
    const spawned = forActivation("resumed-seed").find((record) =>
      Array.isArray(record.args),
    );
    const [rulesPath] = JSON.parse(spawned.configContent).instructions;
    assert.equal(
      readFileSync(rulesPath, "utf8"),
      "canonical room worker prompt",
    );
    assert.equal(
      forActivation("resumed-seed").some(
        (record) =>
          record.path === "/permission/permission-1/reply" &&
          record.body.reply === "always",
      ),
      true,
    );
    assert.equal(
      forActivation("resumed-seed").some(
        (record) => record.path === "/question/question-1/reject",
      ),
      true,
    );
    assert.equal(
      forActivation("cancel-seed").some(
        (record) =>
          typeof record.path === "string" && record.path.endsWith("/abort"),
      ),
      true,
    );
    assert.equal(
      forActivation("cancel-seed").some(
        (record) =>
          record.path === "/permission/cancel-permission/reply" &&
          record.body.reply === "reject",
      ),
      true,
    );
    const cancelRecords = forActivation("cancel-seed");
    const abortIndex = cancelRecords.findIndex(
      (record) =>
        typeof record.path === "string" && record.path.endsWith("/abort"),
    );
    const termIndex = cancelRecords.findIndex(
      (record) => record.signal === "SIGTERM",
    );
    assert.ok(abortIndex >= 0 && termIndex > abortIndex);
    // Full review batch 2 (contract §3): the session loop took the cancelled
    // turn's input, so that session is bound and the next run resumes it
    // instead of silently creating a replacement.
    assert.equal(
      forActivation("cancel-run").some(
        (record) =>
          record.method === "GET" &&
          record.path === "/session/opencode-session-cancelled",
      ),
      true,
      "a cancelled turn whose input was accepted stays bound",
    );
    assert.equal(
      forActivation("cancel-run").some(
        (record) => record.method === "POST" && record.path === "/session",
      ),
      false,
    );
    const projected = JSON.stringify(trajectory);
    assert.doesNotMatch(projected, /PRIVATE_ACTIVATION_INPUT/u);
    assert.match(projected, /native assistant result/u);
    assert.match(projected, /正在核对 Room 状态/u);
    assert.match(projected, /bash已完成/u);
    assert.match(
      projected,
      /npm test/u,
      "pending empty input must not swallow running tool arguments",
    );
    assert.match(projected, /此前 OpenCode 会话无法恢复/u);
    assert.match(projected, /工作轮次结束：interrupted/u);
    assert.doesNotMatch(projected, /opencode-session-(resumed|replacement)/u);
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
      kind: "opencode-server/v1",
    },
    credentialSlots: [],
    declaredCapabilities: ["worker_commands"],
    displayName: "Fake OpenCode native server",
    manifestVersion: 3,
    modelCatalogProbe: { kind: "opencode-cli/v1" },
    protocolFamily: "rah-worker-process/v1",
    recoveryDrivers:
      process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
    runtimeProfileId: "fake-opencode-server",
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
      agentDefinitionRevisionId: "agent-definition-opencode-v1",
      contentDigest: `sha256:${"a".repeat(64)}` as const,
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "memory-opencode",
        contentDigest: `sha256:${"b".repeat(64)}` as const,
        versionId: "memory-opencode-v1",
      },
      skillRefs: [],
    },
    contentDigest: `sha256:${"c".repeat(64)}` as const,
    contextManifestId: `context-opencode-${input.suffix}`,
    createdAt: "2026-08-29T08:00:00.000Z",
    eventRanges: [{ fromSeq: 1, toSeq: 1 }],
    participantId: input.participantId,
    placement: {
      placementId: `placement-opencode-${input.participantId}`,
      runtimeProfileDigest: input.contentDigest as `sha256:${string}`,
      runtimeProfileRevisionId: input.runtimeProfileRevisionId,
      workspaceDefinitionId: "workspace-opencode",
      workspaceMode: "in_place" as const,
      workspaceMountDigest: `sha256:${"d".repeat(64)}` as const,
      workspaceMountRevisionId: "workspace-mount-opencode-v1",
    },
    roomId: "room-opencode",
    runAttemptId: input.runAttemptId,
    schemaVersion: 1 as const,
    throughRoomSeq: 1,
  };
}

async function waitForRecordedPath(
  recordPath: string,
  activationId: string,
  suffix: string,
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
            typeof record.path === "string" &&
            record.path.endsWith(suffix)
          );
        })
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${activationId} ${suffix}`);
}

const fakeOpenCodeServer = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";
const args = process.argv.slice(2);
if (args[0] === "models") {
  process.stdout.write('deepseek/deepseek-v4-flash\\n{"name":"DeepSeek V4 Flash","variants":{"low":{},"high":{},"max":{}}}\\n');
  process.exit(0);
}
if (args[0] !== "serve") process.exit(64);
const activationId = process.env.RAH_ACTIVATION_ID;
const record = (value) => appendFileSync(process.env.FAKE_OPENCODE_RECORD_PATH, JSON.stringify({activationId,...value}) + "\\n");
const hostname = args[args.indexOf("--hostname") + 1];
const port = Number(args[args.indexOf("--port") + 1]);
record({args,permissionEnv:process.env.OPENCODE_PERMISSION,configContent:process.env.OPENCODE_CONFIG_CONTENT});
const streams = new Set();
let pendingPrompt;
let activeSessionId;
const send = (res,status,body) => {
  res.writeHead(status,{"content-type":"application/json"});
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const event = (value) => {
  for (const stream of streams) stream.write("data: " + JSON.stringify(value) + "\\n\\n");
};
const readBody = async (req) => {
  let text = "";
  for await (const chunk of req) text += chunk;
  return text === "" ? undefined : JSON.parse(text);
};
const sessionForActivation = () => {
  if (activationId.includes("missing-run")) return "opencode-session-replacement";
  if (activationId.includes("resumed")) return "opencode-session-resumed";
  if (activationId.includes("missing")) return "opencode-session-missing";
  return "opencode-session-cancelled";
};
const finishPrompt = () => {
  if (!pendingPrompt) return;
  event({type:"message.part.updated",properties:{sessionID:activeSessionId,part:{id:"tool-part",messageID:"assistant-1",type:"tool",callID:"tool-1",tool:"bash",state:{status:"completed",input:{command:"npm test"},output:"ok",title:"test",metadata:{},time:{start:1,end:2}}}}});
  event({type:"message.part.updated",properties:{sessionID:activeSessionId,part:{id:"text-1",messageID:"assistant-1",type:"text",text:"工作已完成"}}});
  event({type:"session.idle",properties:{sessionID:activeSessionId}});
  send(pendingPrompt,200,{info:{id:"assistant-1",sessionID:activeSessionId,role:"assistant",finish:"stop"},parts:[]});
  pendingPrompt = undefined;
};
const server = createServer(async (req,res) => {
  const url = new URL(req.url,"http://127.0.0.1");
  const body = await readBody(req);
  record({method:req.method,path:url.pathname,body,permissionEnv:process.env.OPENCODE_PERMISSION});
  if (req.method === "GET" && url.pathname === "/path") return send(res,200,{directory:process.cwd()});
  if (req.method === "GET" && url.pathname === "/event") {
    res.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-cache"});
    res.write("data: " + JSON.stringify({type:"server.connected",properties:{}}) + "\\n\\n");
    streams.add(res); req.once("close",()=>streams.delete(res)); return;
  }
  // 1.18.32 lists a session's subagent sessions (none here).
  if (req.method === "GET" && url.pathname.startsWith("/session/") && url.pathname.endsWith("/children")) return send(res,200,[]);
  if (req.method === "GET" && url.pathname.startsWith("/session/")) {
    if (activationId.includes("missing-run")) return send(res,404,{name:"NotFoundError"});
    activeSessionId = decodeURIComponent(url.pathname.slice("/session/".length));
    // Every session here was created by the driver with the evo §40 rules.
    return send(res,200,{id:activeSessionId,directory:process.cwd(),title:"existing",time:{created:1,updated:1},permission:[{permission:"*",pattern:"*",action:"allow"},{permission:"question",pattern:"*",action:"deny"},{permission:"plan_enter",pattern:"*",action:"deny"},{permission:"plan_exit",pattern:"*",action:"deny"}]});
  }
  if (req.method === "POST" && url.pathname === "/session") {
    activeSessionId = sessionForActivation();
    return send(res,200,{id:activeSessionId,directory:process.cwd(),title:"created",time:{created:1,updated:1}});
  }
  if (req.method === "POST" && url.pathname.endsWith("/message")) {
    pendingPrompt = res;
    event({type:"session.status",properties:{sessionID:activeSessionId,status:{type:"busy"}}});
    event({type:"session.status",properties:{sessionID:activeSessionId,status:{type:"busy"}}});
    const inputId = body.messageID ?? "input-1";
    event({type:"message.updated",properties:{info:{id:inputId,sessionID:activeSessionId,role:"user"}}});
    event({type:"message.part.updated",properties:{sessionID:activeSessionId,part:{id:"input-part",messageID:inputId,sessionID:activeSessionId,type:"text",text:"PRIVATE_ACTIVATION_INPUT"}}});
    event({type:"message.updated",properties:{info:{id:"assistant-1",parentID:inputId,sessionID:activeSessionId,role:"assistant"}}});
    event({type:"message.part.updated",properties:{part:{id:"native-part",messageID:"assistant-1",sessionID:activeSessionId,type:"text",text:"native assistant result"}}});
    if (activationId.includes("cancel-seed")) return;
    event({type:"message.part.updated",properties:{sessionID:activeSessionId,part:{id:"reasoning-1",messageID:"assistant-1",type:"reasoning",text:"正在核对 Room 状态"}}});
    event({type:"message.part.updated",properties:{sessionID:activeSessionId,part:{id:"tool-part",messageID:"assistant-1",type:"tool",callID:"tool-1",tool:"bash",state:{status:"pending",input:{}}}}});
    event({type:"message.part.updated",properties:{sessionID:activeSessionId,part:{id:"tool-part",messageID:"assistant-1",type:"tool",callID:"tool-1",tool:"bash",state:{status:"running",input:{command:"npm test"},time:{start:1}}}}});
    event({type:"question.asked",properties:{id:"question-1",sessionID:activeSessionId,questions:[]}});
    event({type:"permission.asked",properties:{id:"permission-1",sessionID:activeSessionId,permission:"bash",patterns:["*"],metadata:{},always:["*"]}});
    return;
  }
  if (req.method === "POST" && url.pathname === "/question/question-1/reject") return send(res,200,true);
  if (req.method === "POST" && url.pathname.startsWith("/permission/") && url.pathname.endsWith("/reply")) {
    send(res,200,true);
    if (activationId.includes("cancel-seed")) {
      if (body.reply === "reject" && pendingPrompt) {
        send(pendingPrompt,200,{info:{id:"assistant-abort",sessionID:activeSessionId,role:"assistant",error:{name:"MessageAbortedError",data:{message:"aborted"}}},parts:[]});
        pendingPrompt = undefined;
      }
    } else setImmediate(finishPrompt);
    return;
  }
  if (req.method === "POST" && url.pathname.endsWith("/abort")) {
    send(res,200,true);
    event({type:"permission.asked",properties:{id:"cancel-permission",sessionID:activeSessionId,permission:"bash",patterns:["*"],metadata:{},always:["*"]}});
    return;
  }
  send(res,404,{name:"NotFoundError"});
});
process.on("SIGTERM",()=>{
  record({signal:"SIGTERM"});
  for (const stream of streams) stream.end();
  server.close(()=>process.exit(0));
});
server.listen(port,hostname);
`;
