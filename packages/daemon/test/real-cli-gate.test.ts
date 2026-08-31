import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RoomKernel } from "@rah-os/kernel";

import { DaemonApplication, DaemonConfigSchema } from "../src/index.ts";
import {
  realCliGateProfile,
  type RealCliGateName,
} from "./real-cli-gate-profile.ts";

const selectedGate = process.env.RAH_REAL_CLI_GATE;
const selectedProfile =
  selectedGate === undefined
    ? undefined
    : realCliGateProfile(parseGate(selectedGate), {
        ...(process.env.RAH_REAL_CLI_MODEL === undefined
          ? {}
          : { model: process.env.RAH_REAL_CLI_MODEL }),
        ...(process.env.RAH_REAL_CLI_REASONING === undefined
          ? {}
          : { reasoning: process.env.RAH_REAL_CLI_REASONING }),
      });
const gateName = selectedGate ?? "real-agent";
const gateDescription =
  selectedProfile === undefined
    ? "real Agent"
    : `${selectedGate} ${selectedProfile.model}${selectedProfile.reasoning === undefined ? "" : `/${selectedProfile.reasoning}`}`;
const REAL_CLI_RUN_TIMEOUT_MS = 5 * 60_000;

test(
  `opt-in ${gateDescription} CLI submits a durable Room Task through the Worker API`,
  { skip: selectedProfile === undefined, timeout: 6 * 60_000 },
  async () => {
    assert.ok(selectedProfile, `unsupported RAH_REAL_CLI_GATE=${selectedGate}`);
    const directory = mkdtempSync(join(tmpdir(), "rah-real-codex-"));
    const stateDirectory = join(directory, "state");
    mkdirSync(stateDirectory, { mode: 0o700 });
    const databasePath = join(stateDirectory, "room.db");
    const secretPath = join(stateDirectory, "host.token");
    const kernel = new RoomKernel({ databasePath });
    const shutdown = new AbortController();
    let running: Promise<void> | undefined;
    let observer: RoomKernel | undefined;
    try {
      kernel.initialize();
      const human = kernel.provisionPrincipal({
        handle: `real-${gateName}-human`,
        kind: "human",
      });
      const agent = kernel.provisionPrincipal({
        handle: `real-${gateName}-agent`,
        kind: "agent",
      });
      const humanActor = kernel.authenticateAccessToken(human.accessToken);
      const room = kernel.createRoom(humanActor, {
        name: `Real ${gateName} gate`,
        slug: `real-${gateName}-gate`,
      });
      kernel.addMember(humanActor, {
        principalId: agent.principal.principalId,
        roomId: room.roomId,
      });
      const created = kernel.createTask(humanActor, {
        assigneeId: agent.principal.principalId,
        description:
          "Use the local RAH Worker API only. Do not make repository changes.",
        idempotencyKey: `real-${gateName}-gate-task`,
        roomId: room.roomId,
        title: "Complete the durable RAH Task protocol gate",
      });
      const credential = kernel.provisionHostCredential({
        hostId: `real-${gateName}-host`,
        participantIds: [agent.principal.principalId],
      });
      writeFileSync(secretPath, `${credential.accessToken}\n`, { mode: 0o600 });
      kernel.close();

      const config = DaemonConfigSchema.parse({
        drainTimeoutMs: 10_000,
        host: {
          credential: { path: secretPath, source: "file" },
          hostId: `real-${gateName}-host`,
          participantId: agent.principal.principalId,
        },
        hostStaleAfterMs: 30_000,
        leaseMs: 60_000,
        outboxLeaseMs: 5_000,
        outboxPollIntervalMs: 50,
        outboxRetryAfterMs: 1_000,
        pollIntervalMs: 100,
        retryAfterMs: 60_000,
        runTimeoutMs: REAL_CLI_RUN_TIMEOUT_MS,
        runtime: {
          args: selectedProfile.args(stateDirectory, workerPrompt()),
          command: selectedProfile.command,
          cwd: stateDirectory,
          env: {},
          kind: "generic-process",
          supervisorControlTimeoutMs: 15_000,
          supervisorStartupTimeoutMs: 10_000,
          terminationGraceMs: 5_000,
        },
        runtimeCancelTimeoutMs: 20_000,
        runtimeRecoveryTimeoutMs: 30_000,
        runtimeStartTimeoutMs: 20_000,
        client: { bindHost: "127.0.0.1", port: 0 },
        schemaVersion: 2,
        stateDirectory,
      });
      const application = new DaemonApplication({ config });
      running = application.run({ signal: shutdown.signal });
      await waitUntil(() => application.health().state !== "starting", 10_000);
      assert.equal(
        application.health().state,
        "online",
        JSON.stringify(application.health()),
      );
      const activeObserver = new RoomKernel({ databasePath });
      observer = activeObserver;
      activeObserver.initialize();
      await waitUntil(() => {
        const activation = activeObserver.listActivations({
          roomId: room.roomId,
        })[0];
        const task = activeObserver.listTasks(humanActor, {
          roomId: room.roomId,
        })[0];
        return (
          (activation?.state === "completed" && task?.state === "submitted") ||
          (activation?.state === "queued" && activation.attemptCount > 0) ||
          activation?.state === "quarantined"
        );
      });
      const activation = activeObserver.listActivations({
        roomId: room.roomId,
      })[0];
      const attempts = activeObserver.listRunAttempts({ roomId: room.roomId });
      const task = activeObserver.listTasks(humanActor, {
        roomId: room.roomId,
      })[0];
      assert.equal(
        activation?.state,
        "completed",
        JSON.stringify({ activation, attempts, task }, null, 2),
      );
      assert.equal(
        task?.state,
        "submitted",
        JSON.stringify({ activation, attempts, task }, null, 2),
      );
      assert.equal(task?.taskId, created.task.taskId);
    } finally {
      shutdown.abort("real-cli-gate-finished");
      await running?.catch(() => undefined);
      observer?.close();
      try {
        kernel.close();
      } catch {
        // The seed connection was already closed before daemon startup.
      }
      rmSync(directory, { force: true, recursive: true });
    }
  },
);

function parseGate(value: string): RealCliGateName {
  if (["claude", "codex", "kimi", "opencode"].includes(value)) {
    return value as RealCliGateName;
  }
  throw new Error(`unsupported RAH_REAL_CLI_GATE=${value}`);
}

function workerPrompt(): string {
  return `You are running only as a RAH OS Worker Task protocol gate.
Do not edit files, inspect the credential file, call the Worker HTTP endpoints directly, or expose credentials in output. Provider tool shells may rebuild PATH, so invoke the exact absolute path in process.env.RAH_WORKER_CLI. Use one bounded \`"$RAH_WORKER_CLI" worker\` command per tool call and parse its JSON response:
1. Run \`"$RAH_WORKER_CLI" worker sync\`, require cursorAfter >= Number(process.env.RAH_TO_SEQ), and find the event whose type is "task.created". Its aggregateId is taskId. Preserve this original cursorAfter for acknowledgement.
2. Run \`"$RAH_WORKER_CLI" worker task-get --task-id <taskId>\` and treat response.task as canonical. If it is already submitted or completed, skip to acknowledgement.
3. Starting with basedOnRoomSeq=cursorAfter, run these commands in order. After each command, replace basedOnRoomSeq with response.event.roomSeq only when response.deduplicated is false, because a replayed event may belong to an earlier RunAttempt:
   - \`"$RAH_WORKER_CLI" worker task-claim --task-id <taskId> --idempotency-key real:<taskId>:claim --based-on-room-seq <seq>\`
   - \`"$RAH_WORKER_CLI" worker task-start --task-id <taskId> --idempotency-key real:<taskId>:start --based-on-room-seq <seq>\`
   - \`"$RAH_WORKER_CLI" worker task-progress --task-id <taskId> --progress "Real CLI exercised the durable Task protocol" --idempotency-key real:<taskId>:progress --based-on-room-seq <seq>\`
   - \`"$RAH_WORKER_CLI" worker task-submit --task-id <taskId> --summary "Real CLI completed the durable Task protocol gate" --idempotency-key real:<taskId>:submit --based-on-room-seq <seq>\`
4. Run \`"$RAH_WORKER_CLI" worker acknowledge --through-seq <original-cursorAfter>\`.
5. Exit successfully. Only the durable Task projection and Room events are authoritative; prose and tool output are diagnostics.`;
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = REAL_CLI_RUN_TIMEOUT_MS + 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("real CLI gate timed out");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
