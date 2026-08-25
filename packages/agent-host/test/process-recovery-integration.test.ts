import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { RoomKernel } from "@rah-os/kernel";

import { AgentHost, GenericProcessAdapter } from "../src/index.ts";

const disposableAgentHostPath = fileURLToPath(
  new URL("./fixtures/disposable-agent-host.mjs", import.meta.url),
);
const fakeCliPath = fileURLToPath(
  new URL("./fixtures/fake-cli.mjs", import.meta.url),
);

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!existsSync(path)) {
    if (Date.now() >= deadline)
      throw new Error(`timed out waiting for ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test(
  "AgentHost recovers a prepared Generic runtime after crashing before run.started",
  { skip: process.platform === "win32" },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "rah-os-start-handoff-"));
    const databasePath = join(directory, "room.db");
    const markerFile = join(directory, "target-launched.json");
    const pidFile = join(directory, "fixture-pids.json");
    let leaderPid: number | undefined;
    let disposableHost: ReturnType<typeof spawn> | undefined;
    try {
      const setupKernel = new RoomKernel({ databasePath });
      setupKernel.initialize();
      const human = setupKernel.provisionPrincipal({
        handle: "handoff-human",
        kind: "human",
      });
      const agent = setupKernel.provisionPrincipal({
        handle: "handoff-agent",
        kind: "agent",
      });
      const humanActor = setupKernel.authenticateAccessToken(human.accessToken);
      const room = setupKernel.createRoom(humanActor, {
        name: "Prepared runtime handoff",
        slug: "prepared-runtime-handoff",
      });
      setupKernel.addMember(humanActor, {
        principalId: agent.principal.principalId,
        roomId: room.roomId,
      });
      setupKernel.postMessage(humanActor, {
        body: "Crash after launch but before run.started",
        idempotencyKey: "prepared-runtime-handoff-message",
        recipients: [
          { participantId: agent.principal.principalId, reason: "mention" },
        ],
        roomId: room.roomId,
      });
      const disposableHostToken = setupKernel.provisionHostCredential({
        hostId: "disposable-agent-host",
        participantIds: [agent.principal.principalId],
      }).accessToken;
      const replacementHostToken = setupKernel.provisionHostCredential({
        hostId: "replacement-agent-host",
        participantIds: [agent.principal.principalId],
      }).accessToken;
      setupKernel.close();

      const hostProcess = spawn(process.execPath, [disposableAgentHostPath], {
        env: {
          ...process.env,
          RAH_TEST_DATABASE_PATH: databasePath,
          RAH_TEST_FAKE_CLI_PATH: fakeCliPath,
          RAH_TEST_MARKER_FILE: markerFile,
          RAH_TEST_PID_FILE: pidFile,
          RAH_TEST_HOST_TOKEN: disposableHostToken,
          RAH_TEST_SUPERVISOR_DIRECTORY: directory,
        },
        stdio: ["ignore", "ignore", "pipe"],
      });
      disposableHost = hostProcess;
      let hostStderr = "";
      assert.ok(hostProcess.stderr);
      hostProcess.stderr.setEncoding("utf8");
      hostProcess.stderr.on("data", (chunk: string) => {
        hostStderr += chunk;
      });
      await waitForFile(markerFile);
      await waitForFile(pidFile);
      const pids = JSON.parse(readFileSync(pidFile, "utf8")) as {
        childPid: number;
        leaderPid: number;
      };
      leaderPid = pids.leaderPid;
      assert.equal(processExists(pids.leaderPid), true);
      assert.equal(processExists(pids.childPid), true);

      hostProcess.kill("SIGKILL");
      const hostExit = await new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve, reject) => {
        hostProcess.once("error", reject);
        hostProcess.once("close", (code, signal) => resolve({ code, signal }));
      });
      assert.equal(hostExit.signal, "SIGKILL", hostStderr);
      await new Promise((resolve) => setTimeout(resolve, 125));

      const recoveryKernel = new RoomKernel({ databasePath });
      recoveryKernel.initialize();
      const replacementHost =
        recoveryKernel.authenticateHostAccessToken(replacementHostToken);
      recoveryKernel.heartbeatHost(replacementHost);
      assert.equal(
        recoveryKernel.listRunAttempts({ roomId: room.roomId })[0]?.state,
        "orphaned",
      );
      assert.equal(
        recoveryKernel.listRuntimeProcesses({ roomId: room.roomId })[0]?.state,
        "orphaned",
      );
      assert.equal(
        recoveryKernel.leaseNextActivation(replacementHost, {
          leaseMs: 1_000,
        }),
        null,
      );
      assert.equal(
        recoveryKernel.listRuntimeProcesses({ roomId: room.roomId })[0]?.state,
        "orphaned",
      );

      const runtime = new GenericProcessAdapter({
        command: process.execPath,
        cwd: directory,
        supervisorDirectory: directory,
        terminationGraceMs: 25,
      });
      const replacementAgentHost = new AgentHost({
        host: replacementHost,
        kernel: recoveryKernel,
        leaseMs: 1_000,
        runtime,
      });
      const recovery = await replacementAgentHost.reconcileOrphanOnce();
      assert.equal(recovery.state, "recovered");
      assert.equal(processExists(pids.leaderPid), false);
      assert.equal(processExists(pids.childPid), false);
      assert.equal(
        recoveryKernel.listRuntimeProcesses({ roomId: room.roomId })[0]?.state,
        "terminated",
      );
      assert.equal(
        recoveryKernel.listActivations({ roomId: room.roomId })[0]?.state,
        "queued",
      );
      leaderPid = undefined;
      recoveryKernel.close();
    } finally {
      if (disposableHost?.exitCode === null) disposableHost.kill("SIGKILL");
      if (leaderPid !== undefined && processExists(leaderPid)) {
        process.kill(-leaderPid, "SIGKILL");
      }
      rmSync(directory, { force: true, recursive: true });
    }
  },
);
