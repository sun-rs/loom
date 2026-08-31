import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createResidentRunnerState,
  reduceResidentRunner,
  ResidentRunnerStateStore,
  ResidentRunnerSupervisor,
  type ResidentRunnerExitObservation,
  type ResidentRunnerProcessEvent,
  type ResidentRunnerProcessHandle,
  type ResidentRunnerControlDescriptor,
} from "../src/index.ts";

function control(processGeneration: number): ResidentRunnerControlDescriptor {
  return {
    controlToken: processGeneration.toString(16).padStart(64, "0"),
    instanceId: `018f7f8a-2f3a-7c41-8b62-${processGeneration
      .toString()
      .padStart(12, "0")}`,
    protocol: "rah-resident-runner-control-v1",
  };
}

class FakeProcessHandle implements ResidentRunnerProcessHandle {
  readonly processControl: ResidentRunnerControlDescriptor;
  readonly processGeneration: number;
  readonly processId: number;
  stopCalls = 0;
  launchCalls = 0;
  onLaunch: (() => Promise<void>) | undefined;
  readonly #listeners = new Set<(event: ResidentRunnerProcessEvent) => void>();
  #connected = false;
  #exit: ResidentRunnerExitObservation | undefined;

  constructor(
    processGeneration: number,
    processControl = control(processGeneration),
  ) {
    this.processGeneration = processGeneration;
    this.processControl = processControl;
    this.processId = 10_000 + processGeneration;
  }

  async launch(): Promise<void> {
    this.launchCalls += 1;
    await this.onLaunch?.();
  }

  subscribe(listener: (event: ResidentRunnerProcessEvent) => void): () => void {
    this.#listeners.add(listener);
    if (this.#exit !== undefined) {
      listener({ kind: "exited", observation: this.#exit });
    } else if (this.#connected) {
      listener({ kind: "connected" });
    }
    return () => this.#listeners.delete(listener);
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
  }

  emitConnected(): void {
    if (this.#exit !== undefined) return;
    this.#connected = true;
    for (const listener of this.#listeners) listener({ kind: "connected" });
  }

  emitControlFailure(message: string): void {
    for (const listener of this.#listeners) {
      listener({ kind: "control_failed", message });
    }
  }

  emitExit(observation: ResidentRunnerExitObservation): void {
    if (this.#exit !== undefined) return;
    this.#exit = observation;
    for (const listener of this.#listeners) {
      listener({ kind: "exited", observation });
    }
  }
}

test("resident supervisor persists before spawn and needs explicit connected evidence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-resident-supervisor-"));
  try {
    let nowMs = 1_000;
    const handles: FakeProcessHandle[] = [];
    const store = new ResidentRunnerStateStore({
      statePath: join(directory, "runner-state.json"),
    });
    const supervisor = new ResidentRunnerSupervisor({
      launcher: {
        prepare: async ({ processControl, processGeneration }) => {
          const beforeRegistration = await store.read();
          assert.equal(beforeRegistration.lifecycle, "starting");
          assert.equal(beforeRegistration.processControl, undefined);
          const handle = new FakeProcessHandle(
            processGeneration,
            processControl,
          );
          handle.onLaunch = async () => {
            const registered = await store.read();
            assert.deepEqual(registered.processControl, processControl);
            assert.equal(registered.processId, handle.processId);
          };
          handles.push(handle);
          return handle;
        },
      },
      nowMs: () => nowMs,
      recoveryProbe: {
        inspect: async () => ({ resolution: "absent" }),
      },
      store,
    });
    assert.equal((await supervisor.initialize()).lifecycle, "stopped");

    const starting = await supervisor.reconcile(true);
    assert.equal(starting.lifecycle, "starting");
    assert.equal(starting.processId, handles[0]!.processId);
    assert.deepEqual(starting.processControl, handles[0]!.processControl);
    assert.equal(handles[0]!.launchCalls, 1);
    assert.equal(handles.length, 1);
    assert.equal((await store.read()).lifecycle, "starting");

    handles[0]!.emitConnected();
    const running = await supervisor.flush();
    assert.equal(running.lifecycle, "running");
    assert.equal((await store.read()).lifecycle, "running");

    nowMs = 2_000;
    handles[0]!.emitExit({ code: 1, signal: null });
    const crashed = await supervisor.flush();
    assert.equal(crashed.lifecycle, "crashed");
    assert.equal(crashed.retryAtMs, 4_000);
    assert.equal((await store.read()).lifecycle, "crashed");

    nowMs = 3_999;
    assert.equal((await supervisor.reconcile(true)).lifecycle, "crashed");
    assert.equal(handles.length, 1);
    nowMs = 4_000;
    assert.equal((await supervisor.reconcile(true)).lifecycle, "starting");
    assert.equal(handles.length, 2);
    assert.equal(handles[1]!.processGeneration, 2);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("resident supervisor stop waits for the matching child exit", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-resident-stop-"));
  try {
    let handle: FakeProcessHandle | undefined;
    const supervisor = new ResidentRunnerSupervisor({
      launcher: {
        prepare: async ({ processControl, processGeneration }) => {
          handle = new FakeProcessHandle(processGeneration, processControl);
          return handle;
        },
      },
      nowMs: () => 1_000,
      recoveryProbe: {
        inspect: async () => ({ resolution: "absent" }),
      },
      store: new ResidentRunnerStateStore({
        statePath: join(directory, "runner-state.json"),
      }),
    });
    await supervisor.initialize();
    await supervisor.reconcile(true);
    handle!.emitConnected();
    await supervisor.flush();

    const stopping = await supervisor.reconcile(false);
    assert.equal(stopping.lifecycle, "stopping");
    assert.equal(handle!.stopCalls, 1);
    handle!.emitExit({ code: null, signal: "SIGTERM" });
    const stopped = await supervisor.flush();
    assert.equal(stopped.lifecycle, "stopped");
    assert.equal(stopped.desired, false);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("resident supervisor records a spawn failure instead of losing starting state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-resident-spawn-"));
  try {
    const store = new ResidentRunnerStateStore({
      statePath: join(directory, "runner-state.json"),
    });
    const supervisor = new ResidentRunnerSupervisor({
      launcher: {
        prepare: async () => {
          throw new Error("fixture spawn failed");
        },
      },
      nowMs: () => 5_000,
      recoveryProbe: {
        inspect: async () => ({ resolution: "absent" }),
      },
      store,
    });
    await supervisor.initialize();

    const crashed = await supervisor.reconcile(true);
    assert.equal(crashed.lifecycle, "crashed");
    assert.equal(crashed.retryAtMs, 7_000);
    assert.equal((await store.read()).lifecycle, "crashed");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("resident supervisor adopts or replaces a persisted active generation only from probe evidence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-resident-recovery-"));
  try {
    const connectedPath = join(directory, "connected.json");
    const connectedStore = new ResidentRunnerStateStore({
      statePath: connectedPath,
    });
    const adoptedHandle = new FakeProcessHandle(1);
    let state = reduceResidentRunner(createResidentRunnerState(), {
      desired: true,
      kind: "reconcile",
      nowMs: 1_000,
    }).state;
    state = reduceResidentRunner(state, {
      kind: "process_prepared",
      processControl: adoptedHandle.processControl,
      processGeneration: state.processGeneration,
      processId: adoptedHandle.processId,
    }).state;
    state = reduceResidentRunner(state, {
      kind: "connection_confirmed",
      processGeneration: state.processGeneration,
    }).state;
    await connectedStore.save(state);
    adoptedHandle.emitConnected();
    let spawned = 0;
    const adopted = new ResidentRunnerSupervisor({
      launcher: {
        prepare: async () => {
          spawned += 1;
          return new FakeProcessHandle(2);
        },
      },
      nowMs: () => 2_000,
      recoveryProbe: {
        inspect: async ({ processGeneration, processId }) => {
          assert.equal(processGeneration, 1);
          assert.equal(processId, adoptedHandle.processId);
          return { handle: adoptedHandle, resolution: "connected" };
        },
      },
      store: connectedStore,
    });
    assert.equal((await adopted.initialize()).lifecycle, "running");
    assert.equal(spawned, 0);

    const absentStore = new ResidentRunnerStateStore({
      statePath: join(directory, "absent.json"),
    });
    await absentStore.save(state);
    const replacement = new ResidentRunnerSupervisor({
      launcher: {
        prepare: async ({ processControl, processGeneration }) => {
          spawned += 1;
          return new FakeProcessHandle(processGeneration, processControl);
        },
      },
      nowMs: () => 2_000,
      recoveryProbe: {
        inspect: async () => ({ resolution: "absent" }),
      },
      store: absentStore,
    });
    assert.equal((await replacement.initialize()).lifecycle, "stopped");
    assert.equal((await replacement.reconcile(true)).processGeneration, 2);
    assert.equal(spawned, 1);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("resident supervisor replays signed terminal recovery evidence instead of trusting disappearance", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-resident-terminal-"));
  try {
    const store = new ResidentRunnerStateStore({
      statePath: join(directory, "state.json"),
    });
    const handle = new FakeProcessHandle(1);
    let state = reduceResidentRunner(createResidentRunnerState(), {
      desired: true,
      kind: "reconcile",
      nowMs: 1_000,
    }).state;
    state = reduceResidentRunner(state, {
      kind: "process_prepared",
      processControl: handle.processControl,
      processGeneration: 1,
      processId: handle.processId,
    }).state;
    state = reduceResidentRunner(state, {
      kind: "connection_confirmed",
      processGeneration: 1,
    }).state;
    await store.save(state);

    const supervisor = new ResidentRunnerSupervisor({
      launcher: {
        prepare: async () => assert.fail("terminal recovery must not spawn"),
      },
      nowMs: () => 5_000,
      recoveryProbe: {
        inspect: async ({ processControl }) => {
          assert.deepEqual(processControl, handle.processControl);
          return {
            observation: { code: 1, signal: null },
            resolution: "exited",
          };
        },
      },
      store,
    });

    const recovered = await supervisor.initialize();
    assert.equal(recovered.lifecycle, "crashed");
    assert.equal(recovered.retryAtMs, 7_000);
    assert.equal(recovered.processControl, undefined);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("resident supervisor relaunches a durably prepared wrapper after restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-resident-prepared-"));
  try {
    const store = new ResidentRunnerStateStore({
      statePath: join(directory, "state.json"),
    });
    const handle = new FakeProcessHandle(1);
    let state = reduceResidentRunner(createResidentRunnerState(), {
      desired: true,
      kind: "reconcile",
      nowMs: 1_000,
    }).state;
    state = reduceResidentRunner(state, {
      kind: "process_prepared",
      processControl: handle.processControl,
      processGeneration: 1,
      processId: handle.processId,
    }).state;
    await store.save(state);

    const supervisor = new ResidentRunnerSupervisor({
      launcher: {
        prepare: async () => assert.fail("prepared recovery must adopt"),
      },
      recoveryProbe: {
        inspect: async () => ({ handle, resolution: "prepared" }),
      },
      store,
    });
    const recovered = await supervisor.initialize();
    assert.equal(recovered.lifecycle, "starting");
    assert.equal(handle.launchCalls, 1);
    handle.emitConnected();
    assert.equal((await supervisor.flush()).lifecycle, "running");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("resident supervisor retries an idempotent launch after a transient control failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-resident-launch-retry-"));
  try {
    let attempts = 0;
    let handle: FakeProcessHandle | undefined;
    const supervisor = new ResidentRunnerSupervisor({
      launcher: {
        prepare: async ({ processControl, processGeneration }) => {
          handle = new FakeProcessHandle(processGeneration, processControl);
          handle.onLaunch = async () => {
            attempts += 1;
            if (attempts === 1) throw new Error("transient control loss");
          };
          return handle;
        },
      },
      recoveryProbe: {
        inspect: async () => ({ resolution: "absent" }),
      },
      store: new ResidentRunnerStateStore({
        statePath: join(directory, "state.json"),
      }),
    });
    await supervisor.initialize();
    await assert.rejects(supervisor.reconcile(true), /transient control loss/u);
    assert.equal(supervisor.state().lifecycle, "starting");
    assert.equal(attempts, 1);

    assert.equal((await supervisor.reconcile(true)).lifecycle, "starting");
    assert.equal(attempts, 2);
    handle!.emitConnected();
    assert.equal((await supervisor.flush()).lifecycle, "running");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("resident supervisor surfaces an asynchronous control-plane failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-resident-control-fail-"));
  try {
    let handle: FakeProcessHandle | undefined;
    const supervisor = new ResidentRunnerSupervisor({
      launcher: {
        prepare: async ({ processControl, processGeneration }) => {
          handle = new FakeProcessHandle(processGeneration, processControl);
          return handle;
        },
      },
      recoveryProbe: {
        inspect: async () => ({ resolution: "absent" }),
      },
      store: new ResidentRunnerStateStore({
        statePath: join(directory, "state.json"),
      }),
    });
    await supervisor.initialize();
    await supervisor.reconcile(true);
    handle!.emitConnected();
    await supervisor.flush();

    handle!.emitControlFailure("fixture control authentication failed");
    await assert.rejects(
      supervisor.flush(),
      /fixture control authentication failed/u,
    );
    assert.equal(supervisor.state().lifecycle, "running");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
