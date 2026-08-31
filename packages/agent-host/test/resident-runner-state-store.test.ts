import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createResidentRunnerState,
  reduceResidentRunner,
  ResidentRunnerStateStore,
} from "../src/index.ts";

function runningState() {
  let starting = reduceResidentRunner(createResidentRunnerState(), {
    desired: true,
    kind: "reconcile",
    nowMs: 1_000,
  }).state;
  starting = reduceResidentRunner(starting, {
    kind: "process_prepared",
    processControl: {
      controlToken: "b".repeat(64),
      instanceId: "018f7f8a-2f3a-7c41-8b62-4123d665c102",
      protocol: "rah-resident-runner-control-v1",
    },
    processGeneration: starting.processGeneration,
    processId: 12_345,
  }).state;
  return reduceResidentRunner(starting, {
    kind: "connection_confirmed",
    processGeneration: starting.processGeneration,
  }).state;
}

test("resident runner state is atomically persisted and active startup requires recovery", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-resident-state-"));
  const statePath = join(directory, "runner-state.json");
  try {
    const store = new ResidentRunnerStateStore({ statePath });
    assert.deepEqual(await store.read(), createResidentRunnerState());

    const running = runningState();
    await store.save(running);
    assert.equal(lstatSync(statePath).mode & 0o777, 0o600);
    assert.deepEqual(await store.read(), running);

    const recovered = await store.loadForSupervisorStartup();
    assert.equal(recovered.lifecycle, "recovering");
    assert.equal(recovered.processGeneration, running.processGeneration);
    assert.equal(recovered.processId, 12_345);
    assert.equal(recovered.desired, true);
    assert.deepEqual(
      readdirSync(directory).filter((name) => name.includes(".tmp-")),
      [],
    );

    const envelope = JSON.parse(readFileSync(statePath, "utf8")) as {
      schemaVersion: number;
      state: { lifecycle: string };
    };
    assert.equal(envelope.schemaVersion, 2);
    assert.equal(envelope.state.lifecycle, "running");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("resident runner state keeps degraded crash evidence across restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-resident-degraded-"));
  try {
    const store = new ResidentRunnerStateStore({
      statePath: join(directory, "runner-state.json"),
    });
    let state = createResidentRunnerState();
    for (const nowMs of [1_000, 4_000, 7_000]) {
      state = reduceResidentRunner(state, {
        desired: true,
        kind: "reconcile",
        nowMs,
      }).state;
      state = reduceResidentRunner(state, {
        kind: "process_observed",
        processGeneration: state.processGeneration,
        processId: 20_000 + state.processGeneration,
      }).state;
      state = reduceResidentRunner(state, {
        exitClass: "crash",
        kind: "process_exit",
        nowMs: nowMs + 100,
        processGeneration: state.processGeneration,
      }).state;
    }
    assert.equal(state.lifecycle, "degraded");
    await store.save(state);

    const restored = await store.loadForSupervisorStartup();
    assert.equal(restored.lifecycle, "degraded");
    assert.equal(restored.degradedReason, "crash_budget_exhausted");
    assert.deepEqual(restored.crashTimestampsMs, [1_100, 4_100, 7_100]);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("resident runner state fails closed on symlinks, corrupt data, and newer schemas", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-resident-invalid-"));
  const statePath = join(directory, "runner-state.json");
  try {
    const targetPath = join(directory, "target.json");
    writeFileSync(targetPath, "{}", { mode: 0o600 });
    symlinkSync(targetPath, statePath);
    const symlinkStore = new ResidentRunnerStateStore({ statePath });
    await assert.rejects(symlinkStore.read(), /symbolic link/u);
    await assert.rejects(
      symlinkStore.save(createResidentRunnerState()),
      /symbolic link/u,
    );
    rmSync(statePath);

    writeFileSync(statePath, '{"schemaVersion":1,"state":', {
      mode: 0o600,
    });
    await assert.rejects(
      new ResidentRunnerStateStore({ statePath }).read(),
      /valid JSON/u,
    );

    writeFileSync(
      statePath,
      JSON.stringify({ schemaVersion: 3, state: createResidentRunnerState() }),
      { mode: 0o600 },
    );
    await assert.rejects(
      new ResidentRunnerStateStore({ statePath }).read(),
      /newer Resident Runner schema 3/u,
    );

    writeFileSync(
      statePath,
      JSON.stringify({
        schemaVersion: 2,
        state: {
          ...runningState(),
          processControl: {
            controlToken: "not-a-token",
            instanceId: "not-an-instance",
            protocol: "rah-resident-runner-control-v1",
          },
        },
      }),
      { mode: 0o600 },
    );
    await assert.rejects(
      new ResidentRunnerStateStore({ statePath }).read(),
      /processControl is invalid/u,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("resident runner state rejects non-private storage", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-resident-mode-"));
  try {
    const statePath = join(directory, "runner-state.json");
    const store = new ResidentRunnerStateStore({ statePath });
    await store.save(createResidentRunnerState());
    chmodSync(statePath, 0o644);
    await assert.rejects(store.read(), /owner-private regular file/u);

    rmSync(statePath);
    chmodSync(directory, 0o755);
    await assert.rejects(
      store.save(createResidentRunnerState()),
      /owner-private directory/u,
    );
  } finally {
    chmodSync(directory, 0o700);
    rmSync(directory, { force: true, recursive: true });
  }
});
