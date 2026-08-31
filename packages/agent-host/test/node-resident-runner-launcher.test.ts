import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  NodeResidentRunnerControlPlane,
  ResidentRunnerStateStore,
  ResidentRunnerSupervisor,
  type ResidentRunnerProcessEvent,
  type ResidentRunnerProcessHandle,
  type ResidentRunnerControlDescriptor,
} from "../src/index.ts";

const fixture = new URL(
  "./fixtures/resident-runner-child.mjs",
  import.meta.url,
);
const disposableHostFixture = new URL(
  "./fixtures/disposable-resident-runner-host.mjs",
  import.meta.url,
);

function launcher(directory: string, mode: string) {
  return new NodeResidentRunnerControlPlane({
    args: [fixture.pathname],
    command: process.execPath,
    controlDirectory: join(directory, "control"),
    cwd: directory,
    env: { RAH_RESIDENT_FIXTURE_MODE: mode },
    pollIntervalMs: 5,
    socketDirectory: socketDirectory(directory),
    terminationGraceMs: 25,
  });
}

function socketDirectory(directory: string): string {
  return join(
    "/tmp",
    `rah-rs-${createHash("sha256").update(directory).digest("hex").slice(0, 12)}`,
  );
}

function cleanup(directory: string): void {
  rmSync(socketDirectory(directory), { force: true, recursive: true });
  rmSync(directory, { force: true, recursive: true });
}

function control(processGeneration: number): ResidentRunnerControlDescriptor {
  return {
    controlToken: processGeneration.toString(16).padStart(64, "0"),
    instanceId: `018f7f8a-2f3a-7c41-8b62-${processGeneration
      .toString()
      .padStart(12, "0")}`,
    protocol: "rah-resident-runner-control-v1",
  };
}

function waitForEvent(
  handle: ResidentRunnerProcessHandle,
  kind: ResidentRunnerProcessEvent["kind"],
): Promise<ResidentRunnerProcessEvent> {
  return new Promise((resolve, reject) => {
    let unsubscribe: () => void = () => undefined;
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`timed out waiting for resident child ${kind}`));
    }, 5_000);
    let settled = false;
    unsubscribe = handle.subscribe((event) => {
      if (event.kind !== kind) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(event);
    });
    if (settled) unsubscribe();
  });
}

async function waitForLifecycle(
  supervisor: ResidentRunnerSupervisor,
  lifecycle: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await supervisor.flush()).lifecycle === lifecycle) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for lifecycle ${lifecycle}`);
}

test("Node resident control plane emits explicit connection and signed terminal facts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-node-resident-"));
  let handle: ResidentRunnerProcessHandle | undefined;
  try {
    handle = await launcher(directory, "connected").prepare({
      processControl: control(7),
      processGeneration: 7,
    });
    assert.ok(handle.processId > 0);
    assert.equal(handle.processGeneration, 7);
    await handle.launch();
    assert.deepEqual(await waitForEvent(handle, "connected"), {
      kind: "connected",
    });

    const exited = waitForEvent(handle, "exited");
    await handle.stop();
    assert.deepEqual(await exited, {
      kind: "exited",
      observation: { code: 0, signal: null },
    });
  } finally {
    await handle?.stop().catch(() => undefined);
    cleanup(directory);
  }
});

test("Node resident control plane preserves a structured terminal reason", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-node-terminal-"));
  try {
    const handle = await launcher(directory, "configuration").prepare({
      processControl: control(3),
      processGeneration: 3,
    });
    await handle.launch();
    const event = await waitForEvent(handle, "exited");
    assert.equal(event.kind, "exited");
    if (event.kind === "exited") {
      assert.deepEqual(event.observation, {
        code: 78,
        reason: "configuration",
        signal: null,
      });
    }
  } finally {
    cleanup(directory);
  }
});

test("diagnostic text cannot mark a resident child connected", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-node-diagnostic-"));
  let handle: ResidentRunnerProcessHandle | undefined;
  try {
    handle = await launcher(directory, "diagnostic-only").prepare({
      processControl: control(2),
      processGeneration: 2,
    });
    await handle.launch();
    let connected = false;
    const unsubscribe = handle.subscribe((event) => {
      if (event.kind === "connected") connected = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    unsubscribe();
    assert.equal(connected, false);
  } finally {
    await handle?.stop().catch(() => undefined);
    cleanup(directory);
  }
});

test("the resident target cannot inherit wrapper control credentials", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-node-secret-"));
  let handle: ResidentRunnerProcessHandle | undefined;
  try {
    handle = await launcher(directory, "environment-proof").prepare({
      processControl: control(5),
      processGeneration: 5,
    });
    await handle.launch();
    assert.deepEqual(await waitForEvent(handle, "connected"), {
      kind: "connected",
    });
  } finally {
    await handle?.stop().catch(() => undefined);
    cleanup(directory);
  }
});

test("resident supervisor drives a real isolated IPC child without log parsing", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-node-supervisor-"));
  try {
    const controlPlane = launcher(directory, "connected");
    const supervisor = new ResidentRunnerSupervisor({
      launcher: controlPlane,
      recoveryProbe: controlPlane,
      store: new ResidentRunnerStateStore({
        statePath: join(directory, "runner-state.json"),
      }),
    });
    await supervisor.initialize();
    assert.equal((await supervisor.reconcile(true)).lifecycle, "starting");
    await waitForLifecycle(supervisor, "running");
    assert.ok(supervisor.state().processId! > 0);

    assert.equal((await supervisor.reconcile(false)).lifecycle, "stopping");
    await waitForLifecycle(supervisor, "stopped");
  } finally {
    cleanup(directory);
  }
});

test("a replacement supervisor authenticates and adopts the live resident wrapper", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-node-recovery-"));
  let recoveredHandle: ResidentRunnerProcessHandle | undefined;
  try {
    const controlPlane = launcher(directory, "connected");
    const processControl = control(11);
    const originalHandle = await controlPlane.prepare({
      processControl,
      processGeneration: 11,
    });
    await originalHandle.launch();
    await waitForEvent(originalHandle, "connected");

    const recovered = await controlPlane.inspect({
      processControl,
      processGeneration: 11,
      processId: originalHandle.processId,
    });
    assert.equal(recovered.resolution, "connected");
    if (recovered.resolution !== "connected") assert.fail("not connected");
    recoveredHandle = recovered.handle;
    assert.equal(recoveredHandle.processId, originalHandle.processId);

    await assert.rejects(
      controlPlane.inspect({
        processControl: {
          ...processControl,
          controlToken: "f".repeat(64),
        },
        processGeneration: 11,
        processId: originalHandle.processId,
      }),
      /without terminal proof/u,
    );

    const exited = waitForEvent(recoveredHandle, "exited");
    await recoveredHandle.stop();
    assert.deepEqual(await exited, {
      kind: "exited",
      observation: { code: 0, signal: null },
    });
    const replay = await controlPlane.inspect({
      processControl,
      processGeneration: 11,
      processId: originalHandle.processId,
    });
    assert.deepEqual(replay, {
      observation: { code: 0, signal: null },
      resolution: "exited",
    });

    const resultPath = join(
      directory,
      "control",
      processControl.instanceId,
      "terminal.json",
    );
    const result = JSON.parse(readFileSync(resultPath, "utf8")) as {
      mac: string;
    };
    writeFileSync(
      resultPath,
      JSON.stringify({ ...result, mac: "0".repeat(64) }),
      { mode: 0o600 },
    );
    await assert.rejects(
      controlPlane.inspect({
        processControl,
        processGeneration: 11,
        processId: originalHandle.processId,
      }),
      /terminal authentication failed/u,
    );
  } finally {
    await recoveredHandle?.stop().catch(() => undefined);
    cleanup(directory);
  }
});

test("recovery refuses a persisted PID without an authenticated control capability", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-node-legacy-pid-"));
  try {
    const controlPlane = launcher(directory, "connected");
    await assert.rejects(
      controlPlane.inspect({
        processControl: undefined,
        processGeneration: 1,
        processId: 42,
      }),
      /no authenticated control capability/u,
    );
  } finally {
    cleanup(directory);
  }
});

test("a replacement process adopts the resident runner after abrupt AgentHost exit", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-node-host-loss-"));
  const statePath = join(directory, "runner-state.json");
  try {
    const socketPath = socketDirectory(directory);
    const child = spawn(process.execPath, [disposableHostFixture.pathname], {
      cwd: directory,
      env: {
        RAH_TEST_RESIDENT_CONTROL_DIRECTORY: join(directory, "control"),
        RAH_TEST_RESIDENT_CWD: directory,
        RAH_TEST_RESIDENT_FIXTURE: fixture.pathname,
        RAH_TEST_RESIDENT_SOCKET_DIRECTORY: socketPath,
        RAH_TEST_RESIDENT_STATE_PATH: statePath,
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const announced = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("disposable resident host did not announce")),
        5_000,
      );
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (!stdout.includes("\n")) return;
        clearTimeout(timer);
        resolve();
      });
    });
    child.stderr.on("data", (chunk) => (stderr += chunk));
    await announced;
    child.kill("SIGKILL");
    const exit = await new Promise<{
      code: number | null;
      signal: string | null;
    }>((resolve) =>
      child.once("close", (code, signal) => resolve({ code, signal })),
    );
    assert.deepEqual(exit, { code: null, signal: "SIGKILL" }, stderr);
    const original = JSON.parse(stdout.trim()) as { processId: number };
    assert.ok(original.processId > 0);

    const controlPlane = launcher(directory, "connected");
    const replacement = new ResidentRunnerSupervisor({
      launcher: controlPlane,
      recoveryProbe: controlPlane,
      store: new ResidentRunnerStateStore({ statePath }),
    });
    const recovered = await replacement.initialize();
    assert.equal(recovered.lifecycle, "running");
    assert.equal(recovered.processId, original.processId);

    assert.equal((await replacement.reconcile(false)).lifecycle, "stopping");
    await waitForLifecycle(replacement, "stopped");
  } finally {
    cleanup(directory);
  }
});
