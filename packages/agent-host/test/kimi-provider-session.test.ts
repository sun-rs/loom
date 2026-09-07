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

test("Kimi resumes Host-private ACP sessions and only retries proven side-effect-free loss", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-kimi-provider-session-"));
  chmodSync(directory, 0o700);
  try {
    const executable = join(directory, "fake-kimi-resume-server.mjs");
    const recordPath = join(directory, "resume-record.jsonl");
    writeFileSync(executable, fakeKimiServer, { mode: 0o700 });
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-kimi-resume",
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
    const runtime = implementations.createRuntime(active, report, {
      activationEnvironment: () => ({
        // The daemon compiles the standing prompt per RunAttempt and appends
        // it here; the RuntimeProfile freezes no prompt of its own.
        args: ["--prompt", "canonical room worker prompt"],
        env: { FAKE_KIMI_RECORD_PATH: recordPath },
        standingPromptDigest: "sha256-standing-prompt-digest",
      }),
      cwd: directory,
      providerSessionStore: new ProviderSessionStore({
        rootDirectory: join(directory, "provider-sessions"),
      }),
      supervisorDirectory: join(directory, "supervisors"),
    });
    const trajectory: unknown[] = [];
    const runs = new Map<string, Awaited<ReturnType<typeof runtime.start>>>();
    const runActivation = async (
      scenario: string,
      phase: "seed" | "run",
      completion: "cancel" | "reap" = "reap",
    ) => {
      const suffix = `${scenario}-${phase}`;
      const activationId = `activation-kimi-${suffix}`;
      const runAttemptId = `run-kimi-${suffix}`;
      const participantId = `agent-kimi-${scenario}`;
      const run = await runtime.start(
        {
          activationId,
          consumerId: `consumer-kimi-${suffix}`,
          contextManifest: contextManifest({
            activationId,
            contentDigest: active.contentDigest,
            participantId,
            runAttemptId,
            runtimeProfileRevisionId: active.runtimeProfileRevisionId,
            suffix,
          }),
          fromSeq: 1,
          hostId: "host-kimi-resume",
          participantId,
          reason: "manual",
          roomId: "room-kimi-resume",
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
      runs.set(suffix, run);
      if (completion === "cancel") {
        await waitForRecordedMethod(recordPath, activationId, "session/prompt");
        return runtime.cancel(run);
      }
      return runtime.reap(run);
    };

    for (const scenario of [
      "resumed",
      "missing",
      "prompt-missing",
      "transient",
      "tool-missing",
    ]) {
      assert.equal((await runActivation(scenario, "seed")).code, 0);
    }
    assert.equal((await runActivation("resumed", "run")).code, 0);
    assert.equal((await runActivation("missing", "run")).code, 0);
    assert.equal((await runActivation("prompt-missing", "run")).code, 0);
    assert.equal((await runActivation("transient", "run")).code, 1);
    assert.equal((await runActivation("tool-missing", "run")).code, 1);
    assert.equal((await runActivation("cancel", "seed", "cancel")).code, 0);
    assert.equal((await runActivation("cancel", "run")).code, 0);

    const records = readFileSync(recordPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const methodsFor = (suffix: string): string[] =>
      records
        .filter((record) => record.activationId === `activation-kimi-${suffix}`)
        .map((record) => record.frame?.method)
        .filter(
          (method): method is string =>
            typeof method === "string" && !method.startsWith("process/"),
        );

    assert.deepEqual(methodsFor("resumed-run"), [
      "initialize",
      "session/resume",
      "session/prompt",
    ]);
    assert.deepEqual(methodsFor("missing-run"), [
      "initialize",
      "session/resume",
      "session/new",
      "session/prompt",
    ]);
    assert.deepEqual(methodsFor("prompt-missing-run"), [
      "initialize",
      "session/resume",
      "session/prompt",
      "session/new",
      "session/prompt",
    ]);
    assert.deepEqual(methodsFor("transient-run"), [
      "initialize",
      "session/resume",
    ]);
    assert.deepEqual(methodsFor("tool-missing-run"), [
      "initialize",
      "session/resume",
      "session/prompt",
    ]);
    assert.deepEqual(methodsFor("cancel-seed"), [
      "initialize",
      "session/new",
      "session/prompt",
      "session/cancel",
    ]);
    assert.deepEqual(methodsFor("cancel-run"), [
      "initialize",
      "session/new",
      "session/prompt",
    ]);
    const cancelFrames = records
      .filter((record) => record.activationId === "activation-kimi-cancel-seed")
      .map((record) => record.frame);
    const cancelNotification = cancelFrames.find(
      (frame) => frame?.method === "session/cancel",
    );
    assert.equal(cancelNotification?.id, undefined);
    assert.deepEqual(
      cancelFrames.find((frame) => frame?.id === "cancel-permission")?.result,
      { outcome: { outcome: "cancelled" } },
    );
    assert.equal(
      records.some(
        (record) =>
          record.activationId === "activation-kimi-cancel-seed" &&
          record.frame?.method === "process/SIGTERM",
      ),
      false,
      "the supervisor must let the driver send native cancellation before the Provider child is signalled",
    );

    const projected = JSON.stringify(trajectory);
    assert.doesNotMatch(projected, /LEAKED KIMI HISTORY/u);
    assert.doesNotMatch(projected, /kimi-session-(persisted|replacement)/u);
    assert.match(projected, /此前 Kimi 会话无法恢复/u);
    assert.match(projected, /工作轮次结束：cancelled/u);
    const failedDiagnostics = JSON.stringify([
      runtime.diagnostics(runs.get("transient-run")!),
      runtime.diagnostics(runs.get("tool-missing-run")!),
    ]);
    assert.doesNotMatch(
      failedDiagnostics,
      /kimi-session-(persisted|replacement)/u,
    );
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
      kind: "kimi-acp/v1",
    },
    credentialSlots: [],
    declaredCapabilities: ["worker_commands"],
    displayName: "Fake Kimi resume server",
    manifestVersion: 3,
    modelCatalogProbe: { kind: "kimi-cli/v1" },
    protocolFamily: "rah-worker-process/v1",
    recoveryDrivers:
      process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
    runtimeProfileId: "fake-kimi-resume-server",
    staticEnv: {},
    workspacePolicy: { allowedModes: ["in_place"] },
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
      agentDefinitionRevisionId: "agent-definition-kimi-resume-v1",
      contentDigest: `sha256:${"a".repeat(64)}` as const,
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "memory-kimi-resume",
        contentDigest: `sha256:${"b".repeat(64)}` as const,
        versionId: "memory-kimi-resume-v1",
      },
      skillRefs: [],
    },
    contentDigest: `sha256:${"c".repeat(64)}` as const,
    contextManifestId: `context-kimi-resume-${input.suffix}`,
    createdAt: "2026-08-29T08:00:00.000Z",
    eventRanges: [{ fromSeq: 1, toSeq: 1 }],
    participantId: input.participantId,
    placement: {
      placementId: `placement-kimi-resume-${input.participantId}`,
      runtimeProfileDigest: input.contentDigest as `sha256:${string}`,
      runtimeProfileRevisionId: input.runtimeProfileRevisionId,
      workspaceDefinitionId: "workspace-kimi-resume",
      workspaceMode: "in_place" as const,
      workspaceMountDigest: `sha256:${"d".repeat(64)}` as const,
      workspaceMountRevisionId: "workspace-mount-kimi-resume-v1",
    },
    roomId: "room-kimi-resume",
    runAttemptId: input.runAttemptId,
    schemaVersion: 1 as const,
    throughRoomSeq: 1,
  };
}

const fakeKimiServer = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
if (args.join(" ") === "provider list --json") {
  process.stdout.write(JSON.stringify({models:{"kimi-code/k3":{defaultEffort:"high",displayName:"K3",provider:"managed:kimi-code",supportEfforts:["low","high","max"]}},providers:{}}));
  process.exit(0);
}
if (args[0] !== "acp") process.exit(64);
const activationId = process.env.RAH_ACTIVATION_ID;
const record = (frame) => appendFileSync(process.env.FAKE_KIMI_RECORD_PATH, JSON.stringify({activationId,frame}) + "\\n");
const rl = createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
let activeSessionId = "";
let pendingPromptId;
process.on("SIGTERM", () => record({method:"process/SIGTERM"}));
rl.on("line", (line) => {
  const frame = JSON.parse(line); record(frame);
  if (frame.id === "cancel-permission" && frame.result?.outcome?.outcome === "cancelled") {
    send({jsonrpc:"2.0",id:pendingPromptId,result:{stopReason:"cancelled"}});
    pendingPromptId = undefined;
  } else if (frame.method === "initialize") {
    send({jsonrpc:"2.0",id:frame.id,result:{protocolVersion:1,agentCapabilities:{sessionCapabilities:{resume:{}},mcpCapabilities:{http:true,sse:true}}}});
  } else if (frame.method === "session/resume") {
    activeSessionId = frame.params.sessionId;
    if (activationId === "activation-kimi-missing-run") {
      send({jsonrpc:"2.0",id:frame.id,error:{code:-32602,message:"Invalid params",data:{session_id:"Session not found: " + activeSessionId}}});
    } else if (activationId === "activation-kimi-transient-run") {
      send({jsonrpc:"2.0",id:frame.id,error:{code:-32000,message:"provider temporarily unavailable"}});
    } else {
      send({jsonrpc:"2.0",method:"session/update",params:{sessionId:activeSessionId,update:{sessionUpdate:"agent_message_chunk",messageId:"history",content:{type:"text",text:"LEAKED KIMI HISTORY"}}}});
      send({jsonrpc:"2.0",id:frame.id,result:{sessionId:activeSessionId}});
    }
  } else if (frame.method === "session/new") {
    activeSessionId = activationId.endsWith("-run") ? "kimi-session-replacement" : "kimi-session-persisted";
    send({jsonrpc:"2.0",id:frame.id,result:{sessionId:activeSessionId}});
  } else if (frame.method === "session/prompt") {
    if (activationId === "activation-kimi-cancel-seed") {
      pendingPromptId = frame.id;
    } else if (activationId === "activation-kimi-prompt-missing-run" && activeSessionId === "kimi-session-persisted") {
      send({jsonrpc:"2.0",id:frame.id,error:{code:-32000,message:"unknown session " + activeSessionId}});
    } else if (activationId === "activation-kimi-tool-missing-run") {
      send({jsonrpc:"2.0",method:"session/update",params:{sessionId:activeSessionId,update:{sessionUpdate:"tool_call",toolCallId:"tool-side-effect",title:"write_file",status:"in_progress",rawInput:{path:"changed.txt"}}}});
      send({jsonrpc:"2.0",id:frame.id,error:{code:-32000,message:"unknown session " + activeSessionId}});
    } else {
      send({jsonrpc:"2.0",method:"session/update",params:{sessionId:activeSessionId,update:{sessionUpdate:"agent_message_chunk",messageId:"current",content:{type:"text",text:"Kimi current reply"}}}});
      send({jsonrpc:"2.0",id:frame.id,result:{stopReason:"end_turn"}});
    }
  } else if (frame.method === "session/cancel") {
    if (activationId === "activation-kimi-cancel-seed" && pendingPromptId !== undefined && frame.params.sessionId === activeSessionId) {
      send({jsonrpc:"2.0",id:"cancel-permission",method:"session/request_permission",params:{sessionId:activeSessionId,toolCall:{toolCallId:"cancel-tool"},options:[{optionId:"once",kind:"allow_once"}]}});
    }
  }
});
`;
