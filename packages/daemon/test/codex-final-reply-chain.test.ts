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
} from "@rah-os/agent-host";
import { WorkerApplicationService } from "@rah-os/application-service";
import { RoomKernel } from "@rah-os/kernel";
import type { RuntimeProfileManifestV3 } from "@rah-os/protocol";

import { deliveryAcceptanceRegistration } from "../src/delivery-acceptance-registration.ts";

/**
 * Final-reply turn end, per-turn Codex path end to end: real Kernel and
 * SQLite, real Worker HTTP API and Worker CLI, real Codex app-server driver,
 * GenericProcessAdapter (process supervisor) and AgentHost. Only the Codex
 * app-server is a FAKE model: it posts the reply from a tool item and then,
 * like the real tool loop, requests one more generation that only says
 * "sent" unless the turn was interrupted first. No paid provider runs.
 */
type Mode = "final" | "nofinal";

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-final-reply-chain-"));
  chmodSync(directory, 0o700);
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
  const agent = kernel.provisionPrincipal({ handle: "codex", kind: "agent" });
  const agentId = agent.principal.principalId;
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "Main", slug: "main" });
  kernel.addMember(actor, { roomId: room.roomId, principalId: agentId });
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "host",
      participantIds: [agentId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  const worker = new WorkerApplicationService({ kernel });
  await worker.start();
  const executable = join(directory, "fake-codex-model.mjs");
  writeFileSync(executable, fakeCodexModel, { mode: 0o700 });
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
  const runtime = implementations.createRuntime(active, report, {
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
          ...(resume ? ["--resume-session", "fake-thread"] : []),
        ],
        env: {
          ...lease.env,
          FAKE_CODEX_RECORD_PATH: recordPath,
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
  });
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
    database,
    kernel,
    room,
    setMode(next: Mode) {
      mode = next;
    },
    setResume(next: boolean) {
      resume = next;
    },
    sessionResumeMs(runAttemptId: string) {
      return database
        .prepare(
          "SELECT session_resume_ms FROM run_attempts WHERE run_attempt_id = ?",
        )
        .get(runAttemptId)?.session_resume_ms;
    },
    post(body: string) {
      return kernel.postMessage(actor, {
        body,
        roomId: room.roomId,
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
    finalReply(runAttemptId: string) {
      const row = database
        .prepare(
          "SELECT interrupt_sent, preempted_follow_up FROM run_attempt_final_replies WHERE run_attempt_id = ?",
        )
        .get(runAttemptId);
      return row === undefined ? undefined : { ...row };
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

test("final reply (per-turn): the committed --final post ends the turn with one generation and the Activation completes", async () => {
  const context = await fixture();
  try {
    for (let turn = 1; turn <= 2; turn += 1) {
      context.post(`question ${turn}`);
      const result = await context.agentHost.reconcileOnce();
      assert.equal(result.state, "completed", JSON.stringify(result));
    }
    const records = context.records();
    assert.deepEqual(
      records.filter((r) => r.event === "follow-up-generation"),
      [],
      "the post-reply generation never ran",
    );
    const posts = records.filter((r) => r.event === "command");
    assert.equal(posts.length, 2);
    for (const post of posts) {
      assert.equal(post.status, 0, JSON.stringify(post));
      assert.ok((post.command as string[]).includes("--final"));
    }
    assert.equal(records.filter((r) => r.event === "interrupted").length, 2);
    const runs = context.kernel.listRunAttempts({
      roomId: context.room.roomId,
    });
    assert.equal(runs.length, 2);
    for (const run of runs) {
      assert.equal(run.state, "exited", JSON.stringify(run));
      assert.deepEqual(context.finalReply(run.runAttemptId), {
        interrupt_sent: 1,
        preempted_follow_up: "true",
      });
    }
    for (const process of context.kernel.listRuntimeProcesses({
      roomId: context.room.roomId,
    }))
      assert.equal(process.exitCode, 0);
    assert.ok(
      context.kernel
        .listActivations({ roomId: context.room.roomId })
        .every((activation) => activation.state === "completed"),
    );
  } finally {
    await context.close();
  }
});

test("final reply (per-turn): a reply without --final keeps today's behaviour — the follow-up generation runs", async () => {
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
    assert.deepEqual(
      records.filter((r) => r.event === "interrupted"),
      [],
    );
    const [run] = context.kernel.listRunAttempts({
      roomId: context.room.roomId,
    });
    assert.equal(context.finalReply(run!.runAttemptId), undefined);
  } finally {
    await context.close();
  }
});

test("S2-b: a per-turn (cold) run that resumes its thread records the measured resume duration", async () => {
  const context = await fixture();
  try {
    context.post("fresh question");
    assert.equal((await context.agentHost.reconcileOnce()).state, "completed");
    context.setResume(true);
    context.post("resumed question");
    assert.equal((await context.agentHost.reconcileOnce()).state, "completed");
    const [fresh, resumed] = context.kernel.listRunAttempts({
      roomId: context.room.roomId,
    });
    assert.equal(
      context.sessionResumeMs(fresh!.runAttemptId),
      null,
      "a fresh thread measured no resume",
    );
    const measured = context.sessionResumeMs(resumed!.runAttemptId);
    assert.equal(typeof measured, "number");
    assert.ok((measured as number) >= 60, String(measured));
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
      kind: "codex-app-server/v1",
    },
    credentialSlots: [],
    declaredCapabilities: ["worker_commands"],
    displayName: "FAKE Codex final-reply model",
    manifestVersion: 3,
    modelCatalogProbe: { kind: "codex-cli/v1" },
    protocolFamily: "rah-worker-process/v1",
    recoveryDrivers:
      process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
    runtimeProfileId: "fake-codex-final-reply",
    staticEnv: {},
    workspacePolicy: { allowedModes: ["in_place"] },
  };
}

/** FAKE Codex app-server: posts the wake's reply from a tool item. */
const fakeCodexModel = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
if (args.join(" ") === "debug models" || args.join(" ") === "debug models --bundled") {
  process.stdout.write(JSON.stringify({models:[{slug:"gpt-test",visibility:"list",supported_in_api:true,supported_reasoning_levels:[{effort:"low"}],service_tiers:[]}]}));
  process.exit(0);
}
const activationId = process.env.RAH_ACTIVATION_ID;
const record = (value) => appendFileSync(process.env.FAKE_CODEX_RECORD_PATH, JSON.stringify({activationId,...value}) + "\\n");
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const threadId = "fake-thread";
const turn = "turn-" + activationId;
const notify = (method, params) => send({jsonrpc:"2.0",method,params:{threadId,turnId:turn,...params}});
let interrupted = false;
let wake = () => {};
const cli = (command, input) => new Promise((resolve) => {
  const child = spawn(process.env.RAH_WORKER_CLI, command, { env: process.env, stdio: ["pipe","pipe","pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", (c) => stdout += c);
  child.stderr.on("data", (c) => stderr += c);
  child.stdin.end(input ?? "");
  child.once("close", (status) => { record({ event: "command", command, status, stdout, stderr }); resolve(); });
});
async function act(wake_) {
  const reply = /Reply: message-post --target "[^"]+"(?: --turn \\S+)? --based-on-room-seq (\\d+)( --final)?/.exec(wake_);
  if (!reply) throw new Error("FAKE model found no Reply line in the wake");
  const item = { id: "post-" + activationId, type: "commandExecution" };
  notify("item/started", { item });
  const final = process.env.FAKE_MODE === "final" && reply[2] ? ["--final"] : [];
  await cli(["worker", "message-post", "--based-on-room-seq", reply[1], ...final], "FAKE CODEX reply");
  notify("item/completed", { item: { ...item, status: "completed" } });
  await new Promise((resolve) => { wake = resolve; setTimeout(resolve, 1000); });
  if (!interrupted) {
    notify("item/agentMessage/delta", { itemId: "sent", delta: "sent" });
    record({ event: "follow-up-generation" });
  } else record({ event: "interrupted" });
  send({jsonrpc:"2.0",method:"turn/completed",params:{threadId,turn:{id:turn,status:interrupted ? "interrupted" : "completed"}}});
}
createInterface({ input: process.stdin }).on("line", (line) => {
  const frame = JSON.parse(line);
  if (frame.method === "initialize") send({jsonrpc:"2.0",id:frame.id,result:{userAgent:"fake-codex/1"}});
  else if (frame.method === "thread/start") send({jsonrpc:"2.0",id:frame.id,result:{thread:{id:threadId}}});
  else if (frame.method === "thread/resume") setTimeout(() => send({jsonrpc:"2.0",id:frame.id,result:{thread:{id:frame.params.threadId}}}), 60);
  else if (frame.method === "turn/start") {
    const text = frame.params.input[0].text;
    send({jsonrpc:"2.0",id:frame.id,result:{turn:{id:turn,status:"inProgress"}}});
    notify("turn/started", { turn: { id: turn } });
    setTimeout(() => void act(text), 200);
  } else if (frame.method === "turn/interrupt") {
    if (frame.params.turnId === turn) { interrupted = true; wake(); }
    send({jsonrpc:"2.0",id:frame.id,result:{}});
  }
});
`;
