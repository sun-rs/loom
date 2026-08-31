import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyResidentRunnerExit,
  createResidentRunnerState,
  recoverResidentRunnerState,
  reduceResidentRunner,
} from "../src/index.ts";

test("resident runner exit classification uses terminal facts, never diagnostic text", () => {
  assert.equal(
    classifyResidentRunnerExit({
      code: 0,
      reason: "attachment_revoked",
      signal: null,
    }),
    "attachment_revoked",
  );
  assert.equal(
    classifyResidentRunnerExit({
      code: 78,
      reason: "configuration",
      signal: null,
    }),
    "configuration",
  );
  assert.equal(
    classifyResidentRunnerExit({ code: null, signal: "SIGTERM" }),
    "graceful",
  );
  assert.equal(
    classifyResidentRunnerExit({ code: 0, signal: null }),
    "graceful",
  );
  assert.equal(classifyResidentRunnerExit({ code: 1, signal: null }), "crash");
});

test("resident runner becomes running only after matching connection evidence", () => {
  const initial = createResidentRunnerState();
  const spawning = reduceResidentRunner(initial, {
    desired: true,
    kind: "reconcile",
    nowMs: 1_000,
  });

  assert.equal(spawning.state.lifecycle, "starting");
  assert.equal(spawning.state.processGeneration, 1);
  assert.deepEqual(spawning.effect, { kind: "spawn", processGeneration: 1 });

  const staleReady = reduceResidentRunner(spawning.state, {
    kind: "connection_confirmed",
    processGeneration: 0,
  });
  assert.deepEqual(staleReady.state, spawning.state);
  assert.equal(staleReady.effect, null);

  const ready = reduceResidentRunner(spawning.state, {
    kind: "connection_confirmed",
    processGeneration: 1,
  });
  assert.equal(ready.state.lifecycle, "running");
  assert.equal(ready.effect, null);
});

test("resident runner binds an observed OS process only to its current generation", () => {
  const starting = reduceResidentRunner(createResidentRunnerState(), {
    desired: true,
    kind: "reconcile",
    nowMs: 1_000,
  }).state;
  const stale = reduceResidentRunner(starting, {
    kind: "process_observed",
    processGeneration: 0,
    processId: 41,
  });
  assert.equal(stale.state.processId, undefined);

  const observed = reduceResidentRunner(starting, {
    kind: "process_observed",
    processGeneration: starting.processGeneration,
    processId: 42,
  });
  assert.equal(observed.state.processId, 42);
  const exited = reduceResidentRunner(observed.state, {
    exitClass: "crash",
    kind: "process_exit",
    nowMs: 2_000,
    processGeneration: observed.state.processGeneration,
  });
  assert.equal(exited.state.processId, undefined);
});

test("resident runner persists a generation-bound control capability before observing a process", () => {
  const starting = reduceResidentRunner(createResidentRunnerState(), {
    desired: true,
    kind: "reconcile",
    nowMs: 1_000,
  }).state;
  const processControl = {
    controlToken: "a".repeat(64),
    instanceId: "018f7f8a-2f3a-7c41-8b62-4123d665c101",
    protocol: "rah-resident-runner-control-v1" as const,
  };

  const prepared = reduceResidentRunner(starting, {
    kind: "process_prepared",
    processControl,
    processGeneration: starting.processGeneration,
    processId: 42,
  });
  assert.equal(prepared.state.lifecycle, "starting");
  assert.equal(prepared.state.processId, 42);
  assert.deepEqual(prepared.state.processControl, processControl);

  const recovering = recoverResidentRunnerState(prepared.state);
  assert.equal(recovering.lifecycle, "recovering");
  assert.deepEqual(recovering.processControl, processControl);

  const terminal = reduceResidentRunner(recovering, {
    exitClass: "crash",
    kind: "process_exit",
    nowMs: 2_000,
    processGeneration: recovering.processGeneration,
  });
  assert.equal(terminal.state.lifecycle, "crashed");
  assert.equal(terminal.state.processControl, undefined);
  assert.equal(terminal.state.processId, undefined);
});

test("resident runner backs off and opens its crash circuit after three failures", () => {
  let state = reduceResidentRunner(createResidentRunnerState(), {
    desired: true,
    kind: "reconcile",
    nowMs: 1_000,
  }).state;

  for (const nowMs of [2_000, 5_000]) {
    const crashed = reduceResidentRunner(state, {
      exitClass: "crash",
      kind: "process_exit",
      nowMs,
      processGeneration: state.processGeneration,
    });
    assert.equal(crashed.state.lifecycle, "crashed");
    assert.equal(crashed.state.retryAtMs, nowMs + 2_000);
    assert.equal(crashed.effect, null);

    const tooEarly = reduceResidentRunner(crashed.state, {
      desired: true,
      kind: "reconcile",
      nowMs: nowMs + 1_999,
    });
    assert.equal(tooEarly.state.lifecycle, "crashed");
    assert.equal(tooEarly.effect, null);

    const retry = reduceResidentRunner(crashed.state, {
      desired: true,
      kind: "reconcile",
      nowMs: nowMs + 2_000,
    });
    assert.equal(retry.state.lifecycle, "starting");
    assert.deepEqual(retry.effect, {
      kind: "spawn",
      processGeneration: state.processGeneration + 1,
    });
    state = retry.state;
  }

  const circuitOpen = reduceResidentRunner(state, {
    exitClass: "crash",
    kind: "process_exit",
    nowMs: 8_000,
    processGeneration: state.processGeneration,
  });
  assert.equal(circuitOpen.state.lifecycle, "degraded");
  assert.equal(circuitOpen.state.degradedReason, "crash_budget_exhausted");
  assert.equal(circuitOpen.state.retryAtMs, undefined);
  assert.equal(circuitOpen.effect, null);

  const stillParked = reduceResidentRunner(circuitOpen.state, {
    desired: true,
    kind: "reconcile",
    nowMs: 70_000,
  });
  assert.equal(stillParked.state.lifecycle, "degraded");
  assert.equal(stillParked.effect, null);

  const reset = reduceResidentRunner(stillParked.state, {
    kind: "operator_reset",
    nowMs: 70_001,
  });
  assert.equal(reset.state.lifecycle, "stopped");
  assert.deepEqual(reset.state.crashTimestampsMs, []);
  assert.equal(reset.state.degradedReason, undefined);
});

test("configuration and revoked attachment exits park without auto restart", () => {
  for (const input of [
    {
      exitClass: "configuration" as const,
      reason: "configuration" as const,
    },
    {
      exitClass: "attachment_revoked" as const,
      reason: "attachment_revoked" as const,
    },
  ]) {
    const spawning = reduceResidentRunner(createResidentRunnerState(), {
      desired: true,
      kind: "reconcile",
      nowMs: 1_000,
    }).state;
    const exited = reduceResidentRunner(spawning, {
      exitClass: input.exitClass,
      kind: "process_exit",
      nowMs: 2_000,
      processGeneration: spawning.processGeneration,
    });
    assert.equal(exited.state.lifecycle, "degraded");
    assert.equal(exited.state.degradedReason, input.reason);
    assert.equal(exited.state.retryAtMs, undefined);
    assert.equal(exited.effect, null);
  }
});

test("desired stop and process generation fence late child exits", () => {
  const starting = reduceResidentRunner(createResidentRunnerState(), {
    desired: true,
    kind: "reconcile",
    nowMs: 1_000,
  }).state;
  const running = reduceResidentRunner(starting, {
    kind: "connection_confirmed",
    processGeneration: starting.processGeneration,
  }).state;
  const stopping = reduceResidentRunner(running, {
    desired: false,
    kind: "reconcile",
    nowMs: 2_000,
  });
  assert.equal(stopping.state.lifecycle, "stopping");
  assert.deepEqual(stopping.effect, {
    kind: "stop",
    processGeneration: running.processGeneration,
  });

  const stopped = reduceResidentRunner(stopping.state, {
    exitClass: "graceful",
    kind: "process_exit",
    nowMs: 2_100,
    processGeneration: stopping.state.processGeneration,
  });
  assert.equal(stopped.state.lifecycle, "stopped");
  assert.equal(stopped.state.retryAtMs, undefined);

  const replacement = reduceResidentRunner(stopped.state, {
    desired: true,
    kind: "reconcile",
    nowMs: 3_000,
  }).state;
  assert.equal(replacement.processGeneration, 2);
  const lateOldExit = reduceResidentRunner(replacement, {
    exitClass: "crash",
    kind: "process_exit",
    nowMs: 3_100,
    processGeneration: 1,
  });
  assert.deepEqual(lateOldExit.state, replacement);
  assert.equal(lateOldExit.effect, null);
});

test("supervisor recovery cannot trust or replace an unresolved active child", () => {
  const starting = reduceResidentRunner(createResidentRunnerState(), {
    desired: true,
    kind: "reconcile",
    nowMs: 1_000,
  }).state;
  const running = reduceResidentRunner(starting, {
    kind: "connection_confirmed",
    processGeneration: starting.processGeneration,
  }).state;
  const recovering = recoverResidentRunnerState(running);
  assert.equal(recovering.lifecycle, "recovering");

  const reconcileBeforeProof = reduceResidentRunner(recovering, {
    desired: true,
    kind: "reconcile",
    nowMs: 2_000,
  });
  assert.equal(reconcileBeforeProof.state.lifecycle, "recovering");
  assert.equal(reconcileBeforeProof.effect, null);

  const staleResolution = reduceResidentRunner(recovering, {
    kind: "recovery_resolved",
    processGeneration: 0,
    resolution: "absent",
  });
  assert.deepEqual(staleResolution.state, recovering);

  const absent = reduceResidentRunner(recovering, {
    kind: "recovery_resolved",
    processGeneration: running.processGeneration,
    resolution: "absent",
  });
  assert.equal(absent.state.lifecycle, "stopped");
  const replacement = reduceResidentRunner(absent.state, {
    desired: true,
    kind: "reconcile",
    nowMs: 2_001,
  });
  assert.deepEqual(replacement.effect, {
    kind: "spawn",
    processGeneration: 2,
  });

  const adopted = reduceResidentRunner(recovering, {
    kind: "recovery_resolved",
    processGeneration: running.processGeneration,
    processId: 43,
    resolution: "connected",
  });
  assert.equal(adopted.state.lifecycle, "running");
  assert.equal(adopted.state.processId, 43);
  assert.equal(adopted.effect, null);
});
