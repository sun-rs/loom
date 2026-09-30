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
import { fileURLToPath } from "node:url";
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
 * S2-c3 end to end for the per-turn OpenCode path: real Kernel and SQLite,
 * real Worker HTTP routes and Worker CLI, the real OpenCode server driver,
 * GenericProcessAdapter (process supervisor) and AgentHost. Only
 * `opencode serve` is a FAKE model
 * (`agent-host/test/fixtures/fake-opencode-server.mjs`): its loop creates an
 * assistant whose parent is the caller-chosen user messageID, runs exactly
 * the command the wake names as a bash tool in the server process (so the
 * real Worker CLI posts with the Activation credential), and — like the real
 * loop — then generates once more unless the run was aborted by
 * `POST /session/:id/abort`. No paid provider runs.
 */
const FAKE = fileURLToPath(
  new URL(
    "../../agent-host/test/fixtures/fake-opencode-server.mjs",
    import.meta.url,
  ),
);

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-opencode-wake-chain-"));
  chmodSync(directory, 0o700);
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
  const agent = kernel.provisionPrincipal({
    handle: "opencode",
    kind: "agent",
  });
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
  const executable = join(directory, "fake-opencode-model.mjs");
  writeFileSync(executable, readFileSync(FAKE), { mode: 0o700 });
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
  let scenario = "reply";
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
          args: ["--prompt", "FAKE standing prompt"],
          env: {
            ...lease.env,
            FAKE_RECORD: recordPath,
            FAKE_SCENARIO: scenario,
            FAKE_FOLLOW_UP_MS: "1000",
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
    setScenario(next: string) {
      scenario = next;
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
    command: string;
    exit: { exitCode: number | null };
    output: string;
  }[];

test("bodied wake (OpenCode): one --final reply completes the Activation without message-check and POST /abort ends the run", async () => {
  const context = await fixture();
  try {
    for (let turn = 1; turn <= 2; turn += 1) {
      const posted = context.post(`question ${turn}`);
      const result = await context.agentHost.reconcileOnce();
      assert.equal(result.state, "completed", JSON.stringify(result));
      const prompt = context
        .records()
        .filter((r) => r.event === "prompt")
        .at(-1)!.text as string;
      assert.match(
        prompt,
        new RegExp(
          `^#main seq ${posted.event.roomSeq} msg=[0-9a-f]{8} @human: question ${turn}$`,
          "mu",
        ),
      );
      assert.doesNotMatch(prompt, /--startup/u);
    }
    const records = context.records();
    assert.deepEqual(
      commands(records).filter((c) => c.command.includes("message-check")),
      [],
    );
    for (const command of commands(records)) {
      assert.equal(command.exit.exitCode, 0, command.output);
      assert.ok(command.command.includes("--final"));
    }
    assert.deepEqual(
      records.filter((r) => r.event === "follow-up-generation"),
      [],
      "the post-reply generation never ran",
    );
    assert.equal(records.filter((r) => r.event === "abort").length, 2);
    // The standing rules reached every model request through the server's
    // instructions file, never as a per-message system.
    for (const prompt of records.filter((r) => r.event === "prompt"))
      assert.equal(prompt.system, undefined);
    for (const step of records.filter((r) => r.event === "model-request"))
      assert.ok(
        (step.system as string[]).some((part) =>
          part.endsWith("\nFAKE standing prompt"),
        ),
        JSON.stringify(step),
      );
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

test("bodied wake (OpenCode): explicit progress keeps the follow-up generation and still completes", async () => {
  const context = await fixture();
  try {
    context.setScenario("nofinal");
    context.post("question");
    const result = await context.agentHost.reconcileOnce();
    assert.equal(result.state, "completed", JSON.stringify(result));
    assert.equal(
      context.records().filter((r) => r.event === "follow-up-generation")
        .length,
      1,
    );
    const [run] = context.runs();
    assert.equal(context.finalReply(run!.runAttemptId), undefined);
    assert.ok(context.sentAt(run!.runAttemptId) !== null);
  } finally {
    await context.close();
  }
});

test("bodied wake (OpenCode): a turn that needs no reply completes through message-check", async () => {
  const context = await fixture();
  try {
    context.setScenario("check");
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

test("bodied wake (OpenCode): a prompt the loop never took registers no send and does not complete the Activation", async () => {
  const context = await fixture();
  try {
    context.setScenario("noassistant");
    context.post("question");
    await context.agentHost.reconcileOnce();
    const [run] = context.runs();
    assert.equal(context.sentAt(run!.runAttemptId), null);
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
      kind: "opencode-server/v1",
    },
    credentialSlots: [],
    declaredCapabilities: ["worker_commands"],
    displayName: "FAKE OpenCode bodied-wake model",
    manifestVersion: 3,
    modelCatalogProbe: { kind: "opencode-cli/v1" },
    protocolFamily: "rah-worker-process/v1",
    recoveryDrivers:
      process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
    runtimeProfileId: "fake-opencode-bodied-wake",
    staticEnv: {},
    workspacePolicy: { allowedModes: ["in_place"] },
  };
}
