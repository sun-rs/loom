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
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  AgentHost,
  createWorkerToolTransportEnvironment,
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
  runtimeSupportsBodiedWake,
} from "@rah-os/agent-host";
import { WorkerApplicationService } from "@rah-os/application-service";
import { RoomKernel } from "@rah-os/kernel";
import type { RuntimeProfileManifestV3 } from "@rah-os/protocol";

import { deliveryAcceptanceRegistration } from "../src/delivery-acceptance-registration.ts";

/**
 * S2-c1 end to end for the per-turn Claude path: real Kernel and SQLite, real
 * Worker HTTP routes and Worker CLI, the real Claude stream-json driver,
 * GenericProcessAdapter (process supervisor) and AgentHost. Only the Claude
 * CLI is a FAKE model: it echoes each stdin user message as the
 * `--replay-user-messages` replay (with the inbound uuid, as the installed
 * Claude Code 2.1.282 does), runs exactly the command the wake names as a
 * Bash tool call, and — like the real tool loop — then requests one more
 * generation that only says "sent" unless the turn was interrupted by the
 * native `control_request` interrupt. No paid provider runs.
 */
type Mode =
  "final" | "nofinal" | "check" | "history" | "no-uuid-echo" | "wrong-room";

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-claude-wake-chain-"));
  chmodSync(directory, 0o700);
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
  const agent = kernel.provisionPrincipal({ handle: "claude", kind: "agent" });
  const agentId = agent.principal.principalId;
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "Main", slug: "main" });
  const away = kernel.createRoom(actor, { name: "Away", slug: "away" });
  for (const roomId of [room.roomId, away.roomId])
    kernel.addMember(actor, { roomId, principalId: agentId });
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "host",
      participantIds: [agentId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  const worker = new WorkerApplicationService({ kernel });
  await worker.start();
  const executable = join(directory, "fake-claude-model.mjs");
  writeFileSync(executable, fakeClaudeModel, { mode: 0o700 });
  const recordPath = join(directory, "record.jsonl");
  const profiles = new RuntimeProfileRegistry({
    databasePath: join(directory, "runtime-registry.db"),
    hostId: "host",
  });
  profiles.initialize();
  const implementations = new RuntimeImplementationRegistry();
  const revision = profiles.importManifest(manifest(executable));
  const report = profiles.recordProbeReport(
    await implementations.probeRevision(revision, { cwd: directory }),
  );
  const active = profiles.activateRevision({
    contentDigest: revision.contentDigest,
    runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
  });
  let mode: Mode = "final";
  let resume = false;
  const runtime = implementations.createRuntime(
    active,
    report,
    {
      activationEnvironment: async (scope) => {
        const credential = worker.issueActivationCredential(host, scope);
        const lease = await createWorkerToolTransportEnvironment({
          credentialDirectory: join(directory, "worker-credentials"),
          revokeCredential: credential.revoke,
          workerAccessToken: credential.accessToken,
          workerApiOrigin: worker.origin,
        });
        return {
          ...lease,
          args: [
            "--prompt",
            "FAKE standing prompt",
            ...(resume ? ["--resume-session", "fake-claude-session"] : []),
          ],
          env: {
            ...lease.env,
            FAKE_CLAUDE_RECORD_PATH: recordPath,
            FAKE_MODE: mode,
          },
        };
      },
      recordDeliveryAcceptance: (
        (register) => (scope) =>
          register({
            activationId: scope.activationId,
            consumerId: scope.consumerId,
            runAttemptId: scope.runAttemptId,
          })
      )(deliveryAcceptanceRegistration(kernel, host)),
      cwd: directory,
      supervisorDirectory: join(directory, "supervisors"),
    },
    undefined,
    "full_access",
  );
  const agentHost = new AgentHost({
    drainTimeoutMs: 1_000,
    host,
    kernel,
    leaseMs: 60_000,
    pollIntervalMs: 20,
    retryAfterMs: 0,
    runtime,
  });
  let sequence = 0;
  const database = new DatabaseSync(databasePath, { readOnly: true });
  return {
    agentHost,
    kernel,
    room,
    setMode(next: Mode) {
      mode = next;
    },
    setResume(next: boolean) {
      resume = next;
    },
    post(body: string, roomId = room.roomId) {
      return kernel.postMessage(actor, {
        body,
        roomId,
        recipients: [{ participantId: agentId, reason: "mention" }],
        idempotencyKey: `seed-${++sequence}`,
      });
    },
    records(): Record<string, unknown>[] {
      try {
        return readFileSync(recordPath, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>);
      } catch {
        return [];
      }
    },
    sentAt(runAttemptId: string) {
      return (database
        .prepare(
          "SELECT sent_at FROM activation_presented_windows WHERE run_attempt_id=?",
        )
        .get(runAttemptId)?.sent_at ?? null) as string | null;
    },
    finalReply(runAttemptId: string) {
      const row = database
        .prepare(
          "SELECT interrupt_sent, preempted_follow_up FROM run_attempt_final_replies WHERE run_attempt_id = ?",
        )
        .get(runAttemptId);
      return row === undefined ? undefined : { ...row };
    },
    activations() {
      return kernel.listActivations({ roomId: room.roomId });
    },
    runs() {
      return kernel.listRunAttempts({ roomId: room.roomId });
    },
    async close() {
      database.close();
      await worker.close();
      profiles.close();
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

const commands = (records: Record<string, unknown>[]) =>
  records.filter((r) => r.event === "command") as {
    command: string[];
    status: number;
    stderr: string;
  }[];

test("Claude carries a bodied wake: the driver's replay acceptance is the capability", () => {
  assert.equal(runtimeSupportsBodiedWake("claude-stream-json/v1"), true);
});

test("bodied wake (Claude): one --final reply completes the Activation without message-check and the native interrupt ends the turn", async () => {
  const context = await fixture();
  try {
    for (let turn = 1; turn <= 2; turn += 1) {
      const posted = context.post(`question ${turn}`);
      const result = await context.agentHost.reconcileOnce();
      assert.equal(result.state, "completed", JSON.stringify(result));
      const wake = context
        .records()
        .filter((r) => r.wake !== undefined)
        .at(-1)!.wake as string;
      assert.match(
        wake,
        new RegExp(
          `^#main seq ${posted.event.roomSeq} msg=[0-9a-f]{8} @human: question ${turn}$`,
          "mu",
        ),
      );
      assert.doesNotMatch(wake, /--startup/u);
    }
    const records = context.records();
    assert.deepEqual(
      commands(records).filter((c) => c.command.includes("message-check")),
      [],
    );
    for (const command of commands(records)) {
      assert.equal(command.status, 0, command.stderr);
      assert.ok(command.command.includes("--final"));
    }
    assert.deepEqual(
      records.filter((r) => r.event === "follow-up-generation"),
      [],
      "the post-reply generation never ran",
    );
    assert.equal(records.filter((r) => r.event === "interrupted").length, 2);
    for (const run of context.runs()) {
      assert.equal(run.state, "exited", JSON.stringify(run));
      assert.ok(context.sentAt(run.runAttemptId) !== null, "sent registered");
      assert.deepEqual(context.finalReply(run.runAttemptId), {
        interrupt_sent: 1,
        preempted_follow_up: "true",
      });
    }
    assert.ok(
      context.activations().every((a) => a.state === "completed"),
      JSON.stringify(context.activations()),
    );
  } finally {
    await context.close();
  }
});

test("bodied wake (Claude): explicit progress keeps the follow-up generation and still completes", async () => {
  const context = await fixture();
  try {
    context.setMode("nofinal");
    context.post("question");
    const result = await context.agentHost.reconcileOnce();
    assert.equal(result.state, "completed", JSON.stringify(result));
    const records = context.records();
    assert.equal(
      records.filter((r) => r.event === "follow-up-generation").length,
      1,
    );
    const [run] = context.runs();
    assert.equal(context.finalReply(run!.runAttemptId), undefined);
    assert.ok(context.sentAt(run!.runAttemptId) !== null);
  } finally {
    await context.close();
  }
});

test("bodied wake (Claude): a turn that needs no reply completes through message-check", async () => {
  const context = await fixture();
  try {
    context.setMode("check");
    context.post("FYI, no answer needed");
    const result = await context.agentHost.reconcileOnce();
    assert.equal(result.state, "completed", JSON.stringify(result));
    assert.equal(
      commands(context.records()).filter((c) =>
        c.command.includes("message-check"),
      ).length,
      1,
    );
  } finally {
    await context.close();
  }
});

test("bodied wake (Claude): a resumed session's earlier message never stands in for this turn's acceptance", async () => {
  const context = await fixture();
  try {
    context.post("first question");
    assert.equal((await context.agentHost.reconcileOnce()).state, "completed");
    context.setResume(true);
    context.setMode("history");
    context.post("second question");
    const result = await context.agentHost.reconcileOnce();
    assert.equal(result.state, "completed", JSON.stringify(result));
    const [, second] = context.runs();
    assert.ok(context.sentAt(second!.runAttemptId) !== null);
    const accepted = context
      .records()
      .filter((r) => r.event === "history-replayed");
    assert.equal(accepted.length, 1, "the fake re-emitted an earlier message");
  } finally {
    await context.close();
  }
});

test("bodied wake (Claude): an echo without this turn's uuid registers no send and the reply does not complete the Activation", async () => {
  const context = await fixture();
  try {
    context.setMode("no-uuid-echo");
    context.post("question");
    await context.agentHost.reconcileOnce();
    const [run] = context.runs();
    assert.equal(context.sentAt(run!.runAttemptId), null);
    assert.notEqual(context.activations()[0]!.state, "completed");
  } finally {
    await context.close();
  }
});

test("bodied wake (Claude): a reply in another Room confirms nothing here", async () => {
  const context = await fixture();
  try {
    context.setMode("wrong-room");
    context.post("answer me here please");
    await context.agentHost.reconcileOnce();
    assert.notEqual(context.activations()[0]!.state, "completed");
  } finally {
    await context.close();
  }
});

function manifest(executable: string): RuntimeProfileManifestV3 {
  return {
    adapter: {
      config: { diagnosticByteLimit: 262_144, terminationGraceMs: 1_000 },
      executable,
      fixedArgs: [],
      kind: "claude-stream-json/v1",
    },
    credentialSlots: [],
    declaredCapabilities: ["worker_commands"],
    displayName: "FAKE Claude bodied-wake model",
    manifestVersion: 3,
    modelCatalogProbe: { kind: "claude-cli/v1" },
    protocolFamily: "rah-worker-process/v1",
    recoveryDrivers:
      process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
    runtimeProfileId: "fake-claude-bodied-wake",
    staticEnv: {},
    workspacePolicy: { allowedModes: ["in_place"] },
  };
}

/**
 * FAKE Claude stream-json CLI acting as the model. Replay echoes carry the
 * inbound uuid (`no-uuid-echo` drops it); `history` first re-emits an earlier
 * message of the resumed session with the same text and its own uuid.
 */
const fakeClaudeModel = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
if (args.includes("--version")) { process.stdout.write("2.1.282 (Claude Code)\\n"); process.exit(0); }
const activationId = process.env.RAH_ACTIVATION_ID;
if (!activationId) {
  createInterface({ input: process.stdin }).on("line", (line) => {
    const frame = JSON.parse(line);
    if (frame.type === "control_request") process.stdout.write(JSON.stringify({type:"control_response",response:{request_id:frame.request_id,subtype:"success",response:{models:[{value:"claude-test",displayName:"Claude Test",description:"test",supportsEffort:true,supportedEffortLevels:["low","high"]}]}}}) + "\\n");
  });
} else {
const mode = process.env.FAKE_MODE;
const record = (value) => appendFileSync(process.env.FAKE_CLAUDE_RECORD_PATH, JSON.stringify({activationId,...value}) + "\\n");
const sessionId = "fake-claude-session";
const send = (value) => process.stdout.write(JSON.stringify({session_id:sessionId,...value}) + "\\n");
let interrupted = false;
let started = false;
let wake = () => {};
const cli = (command, input) => new Promise((resolve) => {
  const child = spawn(process.env.RAH_WORKER_CLI, command, { env: process.env, stdio: ["pipe","pipe","pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", (c) => stdout += c);
  child.stderr.on("data", (c) => stderr += c);
  child.stdin.end(input ?? "");
  child.once("close", (status) => { record({ event: "command", command, status, stdout, stderr }); resolve(); });
});
async function act(text) {
  const reply = /(?:Reply: message-post|Reply context:) --target "[^"]+"(?: --turn \\S+)? --based-on-room-seq (\\d+)( --final)?/.exec(text);
  const startup = /message-check --startup/.test(text);
  let command;
  if (mode === "check" || startup || !reply) command = ["worker", "message-check", ...(startup ? ["--startup"] : [])];
  else command = ["worker", "message-post", ...(mode === "wrong-room" ? ["--target", "#away"] : []), "--based-on-room-seq", reply[1], ...(mode !== "nofinal" ? ["--final"] : ["--progress"])];
  const final = command.includes("--final");
  const id = "tool-" + activationId;
  send({type:"assistant",message:{role:"assistant",content:[{type:"tool_use",id,name:"Bash",input:{command:"rah " + command.join(" ") + (final ? " <<'EOF'\\nFAKE CLAUDE reply\\nEOF" : "")}}]}});
  await cli(command, command.includes("message-post") ? "FAKE CLAUDE reply" : "");
  send({type:"user",message:{role:"user",content:[{type:"tool_result",tool_use_id:id,content:"ok"}]}});
  await new Promise((resolve) => { wake = resolve; setTimeout(resolve, 1000); });
  if (interrupted) {
    record({ event: "interrupted" });
    send({type:"result",subtype:"error_during_execution",is_error:true,errors:[],terminal_reason:"aborted_tools",num_turns:1});
    return;
  }
  send({type:"stream_event",event:{type:"message_start"}});
  send({type:"assistant",message:{role:"assistant",content:[{type:"text",text:"sent"}]}});
  record({ event: "follow-up-generation" });
  send({type:"result",subtype:"success",is_error:false,result:"sent",terminal_reason:"completed",num_turns:2});
}
createInterface({ input: process.stdin }).on("line", (line) => {
  const frame = JSON.parse(line);
  if (frame.type === "control_request") {
    if (frame.request.subtype === "interrupt") { interrupted = true; wake(); }
    send({type:"control_response",response:{subtype:"success",request_id:frame.request_id,response:{still_queued:[]}}});
    return;
  }
  if (frame.type !== "user" || started) return;
  started = true;
  const text = frame.message.content.map((part) => part.text).join("");
  record({ wake: text });
  if (mode === "history") {
    send({type:"user",isReplay:true,parent_tool_use_id:null,uuid:"11111111-1111-4111-8111-111111111111",message:{role:"user",content:frame.message.content}});
    record({ event: "history-replayed" });
  }
  const replay = {type:"user",isReplay:true,parent_tool_use_id:null,uuid:frame.uuid,message:{role:"user",content:frame.message.content}};
  if (mode === "no-uuid-echo") delete replay.uuid;
  send(replay);
  // Simulate the new cold launch inventory only when Host supplied its config.
  // These tests deliberately keep using Bash/Worker CLI to cover that fallback.
  const mcpIndex = args.indexOf("--mcp-config");
  const mcp = mcpIndex < 0 ? undefined : JSON.parse(args[mcpIndex + 1]).mcpServers?.loom_worker;
  const internalMcp = mcp && process.env.LOOM_WORKER_MCP_SOCKET && process.env.LOOM_WORKER_MCP_SECRET;
  send({type:"system",subtype:"init",capabilities:["interrupt_receipt_v1","interrupt_cancel_queued_v1"],
    tools: internalMcp ? ["Bash", "mcp__loom_worker__loom_reply"] : ["Bash"],
    mcp_servers: internalMcp ? [{name:"loom_worker",status:"connected"}] : []});
  // Give the Host time to register the acceptance, like a real generation.
  setTimeout(() => void act(text), 200);
}).on("close", () => process.exit(0));
}
`;
