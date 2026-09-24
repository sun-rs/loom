import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
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
  agentMemoryWorkspacePath,
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
 * S1-d end to end: real Kernel, real SQLite, real Worker HTTP routes and the
 * real Worker CLI, the real Codex app-server driver and GenericProcessAdapter
 * (process supervisor on macOS). Only the Codex app-server itself is a fixture:
 * a FAKE model that executes, via "$RAH_WORKER_CLI", exactly the command the
 * wake text tells it to run. No paid provider is started.
 */
type Mode = "reply" | "reply-first" | "check" | "reply-no-check" | "wrong-room";

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-bodied-wake-"));
  chmodSync(directory, 0o700);
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const database = new DatabaseSync(databasePath);
  const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
  const agent = kernel.provisionPrincipal({ handle: "codex", kind: "agent" });
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
  const memoryRoot = join(directory, "agent-memory");
  mkdirSync(memoryRoot, { mode: 0o700 });
  const memoryDirectory = agentMemoryWorkspacePath(memoryRoot, agentId);
  mkdirSync(memoryDirectory, { mode: 0o700 });
  let mode: Mode = "reply";
  let memoryEnv: Record<string, string> = {};
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
        args: ["--prompt", "FAKE standing prompt"],
        env: {
          ...lease.env,
          ...memoryEnv,
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

  let sequence = 0;
  return {
    actor,
    agentId,
    away,
    database,
    kernel,
    room,
    setMode(next: Mode) {
      mode = next;
    },
    setMemory(content: string, systemSnapshot: string | undefined) {
      writeFileSync(join(memoryDirectory, "MEMORY.md"), content, {
        mode: 0o600,
      });
      memoryEnv = {
        RAH_AGENT_MEMORY_DIR: memoryDirectory,
        RAH_AGENT_MEMORY_INDEX: join(memoryDirectory, "MEMORY.md"),
        ...(systemSnapshot === undefined
          ? {}
          : {
              RAH_AGENT_MEMORY_SYSTEM_SHA256: createHash("sha256")
                .update(systemSnapshot)
                .digest("hex"),
            }),
      };
    },
    post(body: string) {
      return kernel.postMessage(actor, {
        body,
        roomId: room.roomId,
        recipients: [{ participantId: agentId, reason: "mention" }],
        idempotencyKey: `seed-${++sequence}`,
      });
    },
    cursor: () =>
      Number(
        database
          .prepare(
            "SELECT last_seq AS n FROM subscription_cursors WHERE room_id=? AND participant_id=? AND consumer_id='worker'",
          )
          .get(room.roomId, agentId)?.n ?? 0,
      ),
    /** Runs one Activation through the real runtime and returns what happened. */
    async runActivation(options: { runtimeNotice?: string } = {}) {
      const activation = kernel.leaseNextActivation(host, { leaseMs: 600_000 });
      assert.ok(activation, "an Activation must be queued");
      const attempt = kernel.createRunAttempt(host, {
        activationId: activation.activationId,
      });
      let runtimeRunId = "";
      let noticeAccepted = 0;
      const handle = await runtime.start(
        {
          activationId: activation.activationId,
          consumerId: "worker",
          fromSeq: activation.fromSeq,
          hostId: "host",
          participantId: agentId,
          reason: activation.reason,
          roomId: room.roomId,
          runAttemptId: attempt.runAttemptId,
          ...(options.runtimeNotice === undefined
            ? {}
            : { runtimeNotice: options.runtimeNotice }),
          toSeq: activation.toSeq,
        },
        {
          recordRuntimeNoticeAccepted: async () => {
            noticeAccepted += 1;
          },
          registerPrepared: async (run) => {
            runtimeRunId = run.runId;
            kernel.prepareRunAttemptRuntime(host, {
              runAttemptId: attempt.runAttemptId,
              runtimeRunId: run.runId,
              recoveryDescriptor: run.recoveryDescriptor!,
            });
          },
          recordTrajectory: async () => undefined,
        },
      );
      kernel.markRunAttemptRunning(host, {
        runAttemptId: attempt.runAttemptId,
        runtimeRunId,
        recoveryDescriptor: handle.recoveryDescriptor!,
      });
      const exit = await runtime.reap(handle);
      const diagnostics = JSON.stringify(runtime.diagnostics(handle));
      assert.equal(exit.code, 0, diagnostics);
      kernel.recordRuntimeTermination(host, {
        runAttemptId: attempt.runAttemptId,
        runtimeRunId,
        exit: { code: 0 },
      });
      kernel.finishRunAttempt(host, {
        runAttemptId: attempt.runAttemptId,
        state: "exited",
        exitCode: 0,
      });
      const records = readFileSync(recordPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .filter((record) => record.activationId === activation.activationId);
      const window = database
        .prepare(
          "SELECT sent_at FROM activation_presented_windows WHERE activation_id=? AND run_attempt_id=?",
        )
        .get(activation.activationId, attempt.runAttemptId);
      return {
        activation,
        diagnostics,
        noticeAccepted,
        wake: records.find((record) => record.wake !== undefined)
          ?.wake as string,
        commands: records
          .filter((record) => record.command !== undefined)
          .map((record) => record as { command: string[]; status: number }),
        sentAt: (window?.sent_at ?? null) as string | null,
        complete: () =>
          kernel.completeActivation(host, {
            activationId: activation.activationId,
            consumerId: "worker",
          }),
      };
    },
    async close() {
      await worker.close();
      profiles.close();
      database.close();
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function checkCommands(commands: readonly { command: string[] }[]) {
  return commands.filter((entry) => entry.command.includes("message-check"));
}

test("bodied wake: one reply with the stated seq completes the Activation without message-check", async () => {
  const context = await fixture();
  try {
    const first = context.post("what is the build status?");
    const second = context.post("and the release date?");
    const result = await context.runActivation();
    assert.match(
      result.wake,
      new RegExp(
        `^#main seq ${first.event.roomSeq} msg=[0-9a-f]{8} @human: what is the build status\\?$`,
        "mu",
      ),
    );
    assert.match(result.wake, /@human: and the release date\?/u);
    assert.match(
      result.wake,
      new RegExp(
        `^Reply: message-post --target "#main" --based-on-room-seq ${second.event.roomSeq} --final · no reply needed: message-check$`,
        "mu",
      ),
    );
    assert.doesNotMatch(result.wake, /--startup/u);
    assert.deepEqual(checkCommands(result.commands), []);
    assert.equal(result.commands.length, 1);
    assert.equal(result.commands[0]!.status, 0, result.diagnostics);
    assert.ok(
      result.sentAt !== null,
      "the Codex acceptance registered the send",
    );
    assert.equal(context.cursor(), result.activation.toSeq);
    assert.doesNotThrow(() => result.complete());
  } finally {
    await context.close();
  }
});

test("bodied wake: a reply that lands before the acceptance is confirmed when the acceptance arrives", async () => {
  const context = await fixture();
  try {
    context.post("quick question");
    context.setMode("reply-first");
    const result = await context.runActivation();
    assert.equal(
      result.commands[0]!.status,
      0,
      JSON.stringify(result.commands),
    );
    assert.ok(result.sentAt !== null);
    assert.equal(context.cursor(), result.activation.toSeq);
    assert.doesNotThrow(() => result.complete());
  } finally {
    await context.close();
  }
});

test("bodied wake: a turn that needs no reply completes through message-check", async () => {
  const context = await fixture();
  try {
    context.post("FYI, no answer needed");
    context.setMode("check");
    const result = await context.runActivation();
    assert.match(result.wake, /no reply needed: message-check$/mu);
    assert.equal(checkCommands(result.commands).length, 1);
    assert.equal(context.cursor(), result.activation.toSeq);
    assert.doesNotThrow(() => result.complete());
  } finally {
    await context.close();
  }
});

test("bodied wake: a reply in another Room confirms nothing here", async () => {
  const context = await fixture();
  try {
    context.post("answer me here please");
    context.setMode("wrong-room");
    const result = await context.runActivation();
    assert.equal(result.commands[0]!.status, 0, result.diagnostics);
    assert.equal(context.cursor(), 0);
    assert.throws(() => result.complete());
  } finally {
    await context.close();
  }
});

test("bodied wake: a truncated window asks for message-check first and a premature reply confirms nothing past the prefix", async () => {
  const context = await fixture();
  try {
    const seqs: number[] = [];
    for (let index = 0; index < 22; index++)
      seqs.push(context.post(`message ${index}`).event.roomSeq);
    context.setMode("reply-no-check");
    const premature = await context.runActivation();
    assert.match(premature.wake, /more events? \(seq \d+-\d+\) not shown/u);
    assert.match(premature.wake, /run message-check first, then reply\.$/mu);
    assert.match(
      premature.wake,
      new RegExp(`Shown through seq ${seqs[19]} of \\d+\\b`, "u"),
    );
    assert.doesNotMatch(premature.wake, /--based-on-room-seq/u);
    assert.ok(
      context.cursor() <= seqs[19]!,
      JSON.stringify(premature.commands),
    );
    assert.throws(
      () => premature.complete(),
      "the unread tail blocks completion",
    );
  } finally {
    await context.close();
  }
});

test("bodied wake: a truncated window completes after the instructed message-check", async () => {
  const context = await fixture();
  try {
    for (let index = 0; index < 22; index++) context.post(`message ${index}`);
    const result = await context.runActivation();
    assert.equal(checkCommands(result.commands).length, 1);
    assert.equal(context.cursor(), result.activation.toSeq);
    assert.doesNotThrow(() => result.complete());
  } finally {
    await context.close();
  }
});

test("bodied wake: an oversized first message falls back to the startup wake and registers no send", async () => {
  const context = await fixture();
  try {
    context.post("x".repeat(70 * 1024));
    const result = await context.runActivation();
    assert.match(result.wake, /message-check --startup/u);
    assert.equal(result.sentAt, null, "no rendering was sent to the runtime");
    assert.equal(checkCommands(result.commands).length, 1);
    assert.equal(context.cursor(), result.activation.toSeq);
    assert.doesNotThrow(() => result.complete());
  } finally {
    await context.close();
  }
});

const NOTICE =
  "Host cleanup after your previous run: 1 leftover background process was stopped. Restart anything you still need. (notice 0123abcd)";

test("S2-0 review P2-2: the cleanup notice rides the bodied wake inside the accepted digest", async () => {
  const context = await fixture();
  try {
    context.post("what is the build status?");
    const result = await context.runActivation({ runtimeNotice: NOTICE });
    assert.equal(result.wake.split(NOTICE).length - 1, 1, result.wake);
    assert.ok(result.wake.endsWith(`\n${NOTICE}`));
    // The acceptance digest covers the actual input, notice included, so
    // the presented window still registers as sent.
    assert.ok(result.sentAt !== null, result.diagnostics);
    assert.equal(result.noticeAccepted, 1);
    assert.doesNotThrow(() => result.complete());
  } finally {
    await context.close();
  }
});

test("S2-0 review P2-2: a startup-wake fallback carries the notice and confirms only the notice", async () => {
  const context = await fixture();
  try {
    context.post("x".repeat(70 * 1024));
    const result = await context.runActivation({ runtimeNotice: NOTICE });
    assert.match(result.wake, /message-check --startup/u);
    assert.equal(result.wake.split(NOTICE).length - 1, 1);
    assert.equal(result.sentAt, null, "no rendering was sent to the runtime");
    assert.equal(result.noticeAccepted, 1);
    assert.doesNotThrow(() => result.complete());
  } finally {
    await context.close();
  }
});

test("bodied wake: without a notice nothing is confirmed for one", async () => {
  const context = await fixture();
  try {
    context.post("hello");
    const result = await context.runActivation();
    assert.ok(result.sentAt !== null);
    assert.equal(result.noticeAccepted, 0);
    assert.doesNotMatch(result.wake, /Host cleanup/u);
    assert.doesNotThrow(() => result.complete());
  } finally {
    await context.close();
  }
});

test("bodied wake: a business fact between messages is shown and confirmed with them", async () => {
  const context = await fixture();
  try {
    context.post("first");
    context.kernel.addMember(context.actor, {
      roomId: context.room.roomId,
      principalId: context.kernel.provisionPrincipal({
        handle: "newcomer",
        kind: "agent",
      }).principal.principalId,
    });
    const joined = context.database
      .prepare(
        "SELECT room_seq AS seq, type FROM room_events WHERE room_id=? ORDER BY room_seq DESC LIMIT 1",
      )
      .get(context.room.roomId) as { seq: number; type: string };
    context.post("second");
    const result = await context.runActivation();
    assert.match(
      result.wake,
      new RegExp(
        `^#main seq ${joined.seq} ${joined.type.replace(".", "\\.")} @`,
        "mu",
      ),
    );
    assert.equal(context.cursor(), result.activation.toSeq);
    assert.doesNotThrow(() => result.complete());
  } finally {
    await context.close();
  }
});

test("bodied wake: the memory index rides the wake only when it differs from the session snapshot", async () => {
  const context = await fixture();
  try {
    context.setMemory(
      "# Memory\n- unchanged index\n",
      "# Memory\n- unchanged index\n",
    );
    context.post("with unchanged memory");
    const unchanged = await context.runActivation();
    assert.doesNotMatch(unchanged.wake, /MEMORY\.md/u);
    unchanged.complete();

    context.setMemory(
      "# Memory\n- edited index\n",
      "# Memory\n- unchanged index\n",
    );
    context.post("with changed memory");
    const changed = await context.runActivation();
    assert.match(changed.wake, /## Complete original MEMORY\.md/u);
    assert.ok(changed.wake.includes("# Memory\n- edited index\n"));
    changed.complete();
  } finally {
    await context.close();
  }
});

test("only drivers with a reliable acceptance signal carry a bodied wake", () => {
  assert.equal(runtimeSupportsBodiedWake("codex-app-server/v1"), true);
  // S2-c1: Claude's replay echo of the wake's own uuid (see the Claude chain).
  assert.equal(runtimeSupportsBodiedWake("claude-stream-json/v1"), true);
  // S2-c2: Kimi's first turn-scoped model update of the only prompt in flight
  // (see the Kimi chain).
  assert.equal(runtimeSupportsBodiedWake("kimi-acp/v1"), true);
  for (const kind of ["opencode-server/v1", "generic-process/v1"])
    assert.equal(runtimeSupportsBodiedWake(kind), false, kind);
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
    displayName: "FAKE Codex bodied-wake model",
    manifestVersion: 3,
    modelCatalogProbe: { kind: "codex-cli/v1" },
    protocolFamily: "rah-worker-process/v1",
    recoveryDrivers:
      process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
    runtimeProfileId: "fake-codex-bodied-wake",
    staticEnv: {},
    workspacePolicy: { allowedModes: ["in_place"] },
  };
}

/** FAKE Codex app-server: acts as the model by running the wake's command. */
const fakeCodexModel = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
if (args.join(" ") === "debug models" || args.join(" ") === "debug models --bundled") {
  process.stdout.write(JSON.stringify({models:[{slug:"gpt-test",visibility:"list",supported_in_api:true,supported_reasoning_levels:[{effort:"low"}],service_tiers:[]}]}));
  process.exit(0);
}
const activationId = process.env.RAH_ACTIVATION_ID;
const mode = process.env.FAKE_MODE;
const record = (value) => appendFileSync(process.env.FAKE_CODEX_RECORD_PATH, JSON.stringify({activationId,...value}) + "\\n");
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const cli = (command, input) => {
  const result = spawnSync(process.env.RAH_WORKER_CLI, command, { input: input ?? "", encoding: "utf8", env: process.env });
  record({ command, status: result.status, stdout: result.stdout, stderr: result.stderr });
};
const act = (wake) => {
  if (mode === "check" || /message-check --startup/.test(wake)) {
    cli(["worker", "message-check", ...(/--startup/.test(wake) ? ["--startup"] : [])]);
    if (mode !== "check") cli(["worker", "message-post", "--target", "#main"], "FAKE CODEX reply after check");
    return;
  }
  const bodied = /Reply: message-post --target "[^"]+" --based-on-room-seq (\\d+)/.exec(wake);
  if (bodied) {
    cli(["worker", "message-post", ...(mode === "wrong-room" ? ["--target", "#away"] : []), "--based-on-room-seq", bodied[1]], "FAKE CODEX reply");
    return;
  }
  const prefix = /Shown through seq (\\d+)/.exec(wake);
  if (!prefix) throw new Error("FAKE model found no reply instruction in the wake");
  if (mode === "reply-no-check") {
    // Ignores the instruction and cites the shorter prefix anyway.
    cli(["worker", "message-post", "--target", "#main", "--based-on-room-seq", prefix[1]], "FAKE CODEX premature reply");
    return;
  }
  cli(["worker", "message-check"]);
  cli(["worker", "message-post", "--target", "#main"], "FAKE CODEX reply after check");
};
let threadId = "fake-thread";
createInterface({ input: process.stdin }).on("line", (line) => {
  const frame = JSON.parse(line);
  if (frame.method === "initialize") send({jsonrpc:"2.0",id:frame.id,result:{userAgent:"fake-codex/1"}});
  else if (frame.method === "thread/start") send({jsonrpc:"2.0",id:frame.id,result:{thread:{id:threadId}}});
  else if (frame.method === "turn/start") {
    const wake = frame.params.input[0].text;
    record({ wake });
    const turn = "turn-" + activationId;
    if (mode === "reply-first") act(wake);
    send({jsonrpc:"2.0",id:frame.id,result:{turn:{id:turn,status:"inProgress"}}});
    // Give the Host time to register the acceptance, like a real generation.
    setTimeout(() => {
      if (mode !== "reply-first") act(wake);
      send({jsonrpc:"2.0",method:"turn/completed",params:{threadId,turn:{id:turn,status:"completed"}}});
    }, mode === "reply-first" ? 0 : 200);
  }
});
`;
