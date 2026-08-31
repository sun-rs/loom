import assert from "node:assert/strict";
import test from "node:test";

import {
  ComputerServiceSupervisor,
  type SupervisedComputerServiceProcess,
} from "../src/index.ts";

test("Computer supervisor is the sole stable-to-experiment child owner", async () => {
  const launched: FakeProcess[] = [];
  const supervisor = new ComputerServiceSupervisor({
    launch: async (slot) => {
      const process = new FakeProcess(100 + launched.length, slot);
      launched.push(process);
      return process;
    },
  });

  assert.deepEqual(await supervisor.start(), {
    kind: "running",
    processId: 100,
    slot: "stable",
  });
  assert.deepEqual(
    await supervisor.stopForHandoff({ expectedProcessId: 100 }),
    { kind: "handoff_waiting" },
  );
  assert.equal(launched[0]?.stopRequests, 1);
  assert.deepEqual(await supervisor.startForHandoff("experiment"), {
    kind: "running",
    processId: 101,
    slot: "experiment",
  });
  assert.equal(await Promise.race([supervisor.completion, "active"]), "active");
  await supervisor.close();
  assert.deepEqual(await supervisor.completion, { kind: "closed" });
});

test("Computer supervisor fails closed on an unexpected child exit", async () => {
  const child = new FakeProcess(211, "stable");
  const supervisor = new ComputerServiceSupervisor({
    launch: async () => child,
  });
  await supervisor.start();
  child.exit({ code: 17, signal: null });
  assert.deepEqual(await supervisor.completion, {
    kind: "fatal",
    reason: "child_exited",
  });
});

test("Computer supervisor times out a coordinator that stopped but never replaced the child", async () => {
  const child = new FakeProcess(301, "stable");
  const supervisor = new ComputerServiceSupervisor({
    handoffTimeoutMs: 25,
    launch: async () => child,
  });
  await supervisor.start();
  await supervisor.stopForHandoff({ expectedProcessId: 301 });
  assert.deepEqual(await supervisor.completion, {
    kind: "fatal",
    reason: "handoff_timed_out",
  });
});

test("Computer supervisor times out a hung replacement launch and stops a late child", async () => {
  const incumbent = new FakeProcess(351, "stable");
  const replacement = new FakeProcess(352, "experiment");
  let resolveReplacement!: (value: FakeProcess) => void;
  const replacementLaunch = new Promise<FakeProcess>((resolve) => {
    resolveReplacement = resolve;
  });
  let launches = 0;
  const supervisor = new ComputerServiceSupervisor({
    handoffTimeoutMs: 25,
    launch: async () => {
      launches += 1;
      return launches === 1 ? incumbent : await replacementLaunch;
    },
  });
  await supervisor.start();
  await supervisor.stopForHandoff({ expectedProcessId: 351 });
  const starting = supervisor.startForHandoff("experiment");
  assert.deepEqual(await supervisor.completion, {
    kind: "fatal",
    reason: "handoff_timed_out",
  });
  resolveReplacement(replacement);
  await assert.rejects(starting, /handoff deadline/u);
  assert.equal(replacement.stopRequests, 1);
  assert.deepEqual(await replacement.exited, { code: 0, signal: null });
});

test("Computer supervisor refuses a stale stop and a start without a proven stop", async () => {
  const child = new FakeProcess(401, "stable");
  const supervisor = new ComputerServiceSupervisor({
    launch: async () => child,
  });
  await supervisor.start();
  await assert.rejects(
    supervisor.stopForHandoff({ expectedProcessId: 400 }),
    /does not own the expected service process/u,
  );
  await assert.rejects(
    supervisor.startForHandoff("experiment"),
    /has not stopped the incumbent/u,
  );
  assert.equal(child.stopRequests, 0);
  await supervisor.close();
});

class FakeProcess implements SupervisedComputerServiceProcess {
  readonly processId: number;
  readonly slot: "experiment" | "stable";
  readonly exited: Promise<
    Readonly<{ code: number | null; signal: string | null }>
  >;
  stopRequests = 0;
  #exit!: (
    value: Readonly<{ code: number | null; signal: string | null }>,
  ) => void;

  constructor(processId: number, slot: "experiment" | "stable") {
    this.processId = processId;
    this.slot = slot;
    this.exited = new Promise((resolve) => {
      this.#exit = resolve;
    });
  }

  exit(value: Readonly<{ code: number | null; signal: string | null }>): void {
    this.#exit(value);
  }

  async requestStop(): Promise<void> {
    this.stopRequests += 1;
    this.exit({ code: 0, signal: null });
  }
}
