import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RoomKernel } from "@rah-os/kernel";

import { DaemonApplication, DaemonConfigSchema } from "../src/index.ts";

const cliProfiles: Record<
  string,
  { args: (cwd: string, prompt: string) => string[]; command: string }
> = {
  claude: {
    args: (_cwd, prompt) => [
      "--print",
      "--safe-mode",
      "--no-session-persistence",
      "--dangerously-skip-permissions",
      "--model",
      "claude-sonnet-5",
      "--effort",
      "low",
      prompt,
    ],
    command: "claude",
  },
  codex: {
    args: (cwd, prompt) => [
      "exec",
      "--ephemeral",
      "--ignore-rules",
      "--ignore-user-config",
      "--skip-git-repo-check",
      "--model",
      "gpt-5.6-luna",
      "--sandbox",
      "danger-full-access",
      "--cd",
      cwd,
      prompt,
    ],
    command: "codex",
  },
  kimi: {
    args: (_cwd, prompt) => ["--output-format", "text", "--prompt", prompt],
    command: "kimi",
  },
  opencode: {
    args: (cwd, prompt) => ["run", "--auto", "--pure", "--dir", cwd, prompt],
    command: "opencode",
  },
};

const selectedGate = process.env.RAH_REAL_CLI_GATE;
const selectedProfile =
  selectedGate === undefined ? undefined : cliProfiles[selectedGate];
const gateName = selectedGate ?? "real-agent";

test(
  `opt-in ${selectedGate ?? "real Agent"} CLI submits a durable Room Task through the Worker API`,
  { skip: selectedProfile === undefined, timeout: 180_000 },
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
        runTimeoutMs: 120_000,
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
      assert.equal(
        activation?.state,
        "completed",
        JSON.stringify({ activation, attempts }, null, 2),
      );
      const task = activeObserver.listTasks(humanActor, {
        roomId: room.roomId,
      })[0];
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

function workerPrompt(): string {
  return `You are running only as a RAH OS Worker Task protocol gate.
Do not edit files and do not expose the bearer token in output.
Use one local shell command with Node.js built-in fetch to:
1. POST JSON {} to process.env.RAH_WORKER_API_URL + "/v1/worker/sync" with Authorization "Bearer " + process.env.RAH_WORKER_TOKEN and Content-Type application/json.
2. Parse the response, require response.ok, require cursorAfter >= Number(process.env.RAH_TO_SEQ), and find the event whose type is "task.created". Its aggregateId is taskId.
3. POST {taskId} to "/v1/worker/tasks/get", require response.ok, and treat response.task as the canonical Task state. If it is already submitted or completed, skip to acknowledgement.
4. Starting with basedOnRoomSeq=cursorAfter, POST these strict JSON commands in order with the same headers. After each response require response.ok; replace basedOnRoomSeq with response.event.roomSeq only when response.deduplicated is false, because a replayed event may belong to an earlier RunAttempt:
   - /v1/worker/tasks/claim: {taskId,idempotencyKey:"real:"+taskId+":claim",basedOnRoomSeq}
   - /v1/worker/tasks/start: {taskId,idempotencyKey:"real:"+taskId+":start",basedOnRoomSeq}
   - /v1/worker/tasks/progress: add progress:"Real CLI exercised the durable Task protocol" and use idempotencyKey ending ":progress"
   - /v1/worker/tasks/submit: add summary:"Real CLI completed the durable Task protocol gate" and use idempotencyKey ending ":submit"
5. POST {"throughSeq": the original sync cursorAfter} to "/v1/worker/acknowledge" and require response.ok.
6. Exit successfully. Only the durable Task projection and Room events are authoritative; prose and tool output are diagnostics.`;
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 150_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("real CLI gate timed out");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
