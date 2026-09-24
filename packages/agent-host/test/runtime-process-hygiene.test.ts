import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { RoomKernel } from "@rah-os/kernel";

import {
  AgentHost,
  createKernelAgentHostControlPort,
  createSystemProcessTable,
  FakeRuntimeAdapter,
  GenericProcessAdapter,
  LeftoverProcessSweeper,
  RuntimeProcessHygiene,
  type LeftoverFootprint,
  type LeftoverSweepResult,
} from "../src/index.ts";

const leftoverCliPath = fileURLToPath(
  new URL("./fixtures/leftover-cli.mjs", import.meta.url),
);

const EMPTY_FOOTPRINT: LeftoverFootprint = {
  listeningPorts: [],
  portsObserved: true,
  processCount: 0,
  rssKb: 0,
};

function sweepResult(
  overrides: Partial<LeftoverSweepResult> = {},
): LeftoverSweepResult {
  return {
    footprint: EMPTY_FOOTPRINT,
    found: 0,
    killed: 0,
    portsObserved: true,
    releasedPorts: [],
    remaining: 0,
    remainingPorts: [],
    unknown: 0,
    ...overrides,
  };
}

/** Scripted sweeper: no real process is ever signalled. */
class ScriptedSweeper {
  readonly sweeps: string[][] = [];
  readonly measures: string[][] = [];
  tagged = new Set<string>();
  next: (ids: ReadonlySet<string>) => LeftoverSweepResult = () => sweepResult();
  footprint: LeftoverFootprint = EMPTY_FOOTPRINT;

  async sweep(ids: ReadonlySet<string>): Promise<LeftoverSweepResult> {
    this.sweeps.push([...ids].sort());
    return this.next(ids);
  }

  async measure(ids: ReadonlySet<string>): Promise<LeftoverFootprint> {
    this.measures.push([...ids].sort());
    return this.footprint;
  }

  async taggedRuntimeIds(): Promise<Set<string>> {
    return new Set(this.tagged);
  }
}

function fixture(name: string) {
  const directory = mkdtempSync(join(tmpdir(), `rah-os-hygiene-${name}-`));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  kernel.initialize();
  const human = kernel.provisionPrincipal({
    handle: `${name}-human`,
    kind: "human",
  });
  const agent = kernel.provisionPrincipal({
    handle: `${name}-agent`,
    kind: "agent",
  });
  const humanActor = kernel.authenticateAccessToken(human.accessToken);
  const agentActor = kernel.authenticateAccessToken(agent.accessToken);
  const room = kernel.createRoom(humanActor, { name, slug: name });
  kernel.addMember(humanActor, {
    principalId: agent.principal.principalId,
    roomId: room.roomId,
  });
  const credential = kernel.provisionHostCredential({
    hostId: `${name}-host`,
    participantIds: [agent.principal.principalId],
  });
  const host = kernel.authenticateHostAccessToken(credential.accessToken);
  kernel.heartbeatHost(host);
  let messages = 0;
  return {
    agentId: agent.principal.principalId,
    cleanup() {
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    },
    directory,
    host,
    humanActor,
    kernel,
    post() {
      messages += 1;
      kernel.postMessage(humanActor, {
        body: `work ${messages}`,
        idempotencyKey: `${name}-message-${messages}`,
        recipients: [
          { participantId: agent.principal.principalId, reason: "mention" },
        ],
        roomId: room.roomId,
      });
    },
    /** A fake Agent that reads its delivery, so Activations complete. */
    acknowledge(input: { consumerId: string; roomId: string }) {
      const delivery = kernel.sync(agentActor, input);
      kernel.acknowledgeCursor(agentActor, {
        ...input,
        throughSeq: delivery.cursorAfter,
      });
    },
    roomId: room.roomId,
    latestSeq() {
      return kernel.sync(humanActor, {
        afterSeq: 0,
        consumerId: `${name}-seq-${messages}`,
        roomId: room.roomId,
      }).latestRoomSeq;
    },
  };
}

function cleanupRows(kernel: RoomKernel, roomId: string) {
  return kernel
    .listRunAttempts({ roomId })
    .flatMap((run) =>
      kernel.runtimeProcessCleanup.listForRunAttempt(run.runAttemptId),
    );
}

test("S2-0 run end sweeps the dead runtime and the next wake carries one cleanup line", async () => {
  const f = fixture("run-end");
  try {
    const sweeper = new ScriptedSweeper();
    sweeper.next = (ids) =>
      ids.has("fake-run-1")
        ? sweepResult({ found: 2, killed: 2, releasedPorts: [3000] })
        : sweepResult();
    const runtime = new FakeRuntimeAdapter({ onStart: f.acknowledge });
    const host = new AgentHost({
      host: f.host,
      kernel: f.kernel,
      leaseMs: 30_000,
      processHygiene: new RuntimeProcessHygiene({ sweeper }),
      runtime,
    });
    f.post();
    assert.equal((await host.reconcileOnce()).state, "completed");
    assert.deepEqual(sweeper.sweeps, [["fake-run-1"]]);
    const [row] = cleanupRows(f.kernel, f.roomId);
    assert.equal(row?.trigger, "run_end");
    assert.equal(row?.killedCount, 2);
    assert.deepEqual(row?.releasedPorts, [3000]);
    assert.equal(runtime.starts[0]?.runtimeNotice, undefined);

    f.post();
    assert.equal((await host.reconcileOnce()).state, "completed");
    assert.match(
      runtime.starts[1]?.runtimeNotice ?? "",
      /2 leftover background processes were stopped; listening port 3000 released/u,
    );
    f.post();
    assert.equal((await host.reconcileOnce()).state, "completed");
    assert.equal(runtime.starts[2]?.runtimeNotice, undefined);
  } finally {
    f.cleanup();
  }
});

test("S2-0 a crashed run is swept and recorded as runtime_crash", async () => {
  const f = fixture("crash");
  try {
    const sweeper = new ScriptedSweeper();
    sweeper.next = () => sweepResult({ found: 1, killed: 1 });
    const runtime = new FakeRuntimeAdapter({ onStart: f.acknowledge });
    runtime.enqueueExit({ code: 3 });
    const host = new AgentHost({
      host: f.host,
      kernel: f.kernel,
      leaseMs: 30_000,
      processHygiene: new RuntimeProcessHygiene({ sweeper }),
      retryAfterMs: 0,
      runtime,
    });
    f.post();
    assert.equal((await host.reconcileOnce()).state, "failed");
    assert.deepEqual(sweeper.sweeps, [["fake-run-1"]]);
    assert.equal(cleanupRows(f.kernel, f.roomId)[0]?.trigger, "runtime_crash");
  } finally {
    f.cleanup();
  }
});

test("S2-0 cleanup failure blocks new execution and alerts until a clean sweep", async () => {
  const f = fixture("blocked");
  try {
    const sweeper = new ScriptedSweeper();
    let stuck = true;
    sweeper.next = () =>
      stuck
        ? sweepResult({
            found: 1,
            killed: 0,
            remaining: 1,
            remainingPorts: [5173],
          })
        : sweepResult({ found: 1, killed: 1, releasedPorts: [5173] });
    const alerts: string[] = [];
    const runtime = new FakeRuntimeAdapter({ onStart: f.acknowledge });
    const host = new AgentHost({
      host: f.host,
      kernel: f.kernel,
      leaseMs: 30_000,
      processHygiene: new RuntimeProcessHygiene({
        onAlert: (alert) => alerts.push(alert.message),
        sweeper,
      }),
      retryAfterMs: 0,
      runtime,
    });
    f.post();
    assert.equal((await host.reconcileOnce()).state, "completed");
    assert.equal(alerts.length, 1);
    assert.match(alerts[0]!, /1 leftover process/u);
    // Room removal waits for the old processes to be gone.
    assert.throws(
      () =>
        f.kernel.removeRoomMember(f.humanActor, {
          basedOnRoomSeq: f.latestSeq(),
          idempotencyKey: "blocked-removal",
          principalId: f.agentId,
          roomId: f.roomId,
        }),
      /unresolved leftover processes/u,
    );

    // The leftover still carries the dead runtime's tag.
    sweeper.tagged = new Set(["fake-run-1"]);
    f.post();
    const refused = await host.reconcileOnce();
    assert.equal(refused.state, "failed");
    assert.match(
      refused.state === "failed" ? refused.error : "",
      /RAH_RUNTIME_CLEANUP_BLOCKED/u,
    );
    assert.equal(runtime.starts.length, 1, "no launch while blocked");

    stuck = false;
    const resumed = await host.reconcileOnce();
    assert.equal(resumed.state, "completed");
    assert.equal(runtime.starts.length, 2);
    assert.match(runtime.starts[1]?.runtimeNotice ?? "", /port 5173/u);
  } finally {
    f.cleanup();
  }
});

test("S2-0 a resource cap during a busy run alerts and blocks admission without cancelling it", async () => {
  const f = fixture("cap");
  try {
    const sweeper = new ScriptedSweeper();
    sweeper.footprint = {
      listeningPorts: [3000, 3001, 3002],
      portsObserved: true,
      processCount: 3,
      rssKb: 10,
    };
    const alerts: string[] = [];
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const runtime = new FakeRuntimeAdapter({
      onReap: async () => {
        await released;
        return { code: 0 };
      },
      onStart: f.acknowledge,
    });
    const hygiene = new RuntimeProcessHygiene({
      capCheckIntervalMs: 1,
      caps: { maxListeningPorts: 2 },
      onAlert: (alert) => {
        alerts.push(alert.message);
        release();
      },
      sweeper,
    });
    const host = new AgentHost({
      host: f.host,
      kernel: f.kernel,
      leaseMs: 30_000,
      processHygiene: hygiene,
      runtime,
    });
    f.post();
    const result = await host.reconcileOnce();
    assert.equal(result.state, "completed");
    assert.equal(runtime.cancellations.length, 0);
    assert.match(alerts[0] ?? "", /listening_ports/u);
    const rows = cleanupRows(f.kernel, f.roomId);
    assert.deepEqual(
      rows.map((row) => [row.trigger, row.blocking]),
      [
        ["resource_cap", true],
        ["run_end", false],
      ],
    );
  } finally {
    f.cleanup();
  }
});

test("S2-0 host-start janitor sweeps tagged leftovers of terminated runtimes only", async () => {
  const f = fixture("janitor");
  try {
    const runtime = new FakeRuntimeAdapter({ onStart: f.acknowledge });
    f.post();
    await new AgentHost({
      host: f.host,
      kernel: f.kernel,
      leaseMs: 30_000,
      runtime,
    }).reconcileOnce();
    const sweeper = new ScriptedSweeper();
    sweeper.tagged = new Set(["fake-run-1", "process:other-daemon"]);
    sweeper.next = () => sweepResult({ found: 1, killed: 1 });
    const hygiene = new RuntimeProcessHygiene({ sweeper });
    await hygiene.janitor(
      createKernelAgentHostControlPort(f.kernel, f.host),
      "host_start",
    );
    assert.deepEqual(sweeper.sweeps, [["fake-run-1"]]);
    assert.equal(cleanupRows(f.kernel, f.roomId)[0]?.trigger, "host_start");
  } finally {
    f.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Real processes through the Host (fake CLI; never a real Provider).

const realProcesses =
  process.platform === "darwin" || process.platform === "linux";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function portOpen(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

type LeftoverReport = {
  detached: { pid: number };
  listener: { pid: number; port: number };
};

for (const scenario of ["run_end", "runtime_crash", "host_start"] as const) {
  test(
    `S2-0 real fake-CLI leftovers are cleaned: ${scenario}`,
    { skip: !realProcesses },
    async () => {
      const f = fixture(`real-${scenario.replace("_", "-")}`);
      const report = join(f.directory, "report.json");
      let leftovers: LeftoverReport | undefined;
      try {
        const runtime = new GenericProcessAdapter({
          args: [leftoverCliPath],
          command: process.execPath,
          cwd: f.directory,
          env: {
            RAH_LEFTOVER_EXIT: scenario === "runtime_crash" ? "3" : "0",
            RAH_LEFTOVER_REPORT: report,
          },
          supervisorDirectory: join(f.directory, "supervisors"),
          terminationGraceMs: 200,
        });
        const hygiene = new RuntimeProcessHygiene({
          sweeper: new LeftoverProcessSweeper({
            graceMs: 300,
            table: createSystemProcessTable(),
          }),
        });
        f.post();
        await new AgentHost({
          host: f.host,
          kernel: f.kernel,
          leaseMs: 30_000,
          // host_start: the run itself has no hygiene; the janitor finds it.
          ...(scenario === "host_start" ? {} : { processHygiene: hygiene }),
          retryAfterMs: 60_000,
          runtime,
        }).reconcileOnce();
        leftovers = JSON.parse(readFileSync(report, "utf8")) as LeftoverReport;
        if (scenario === "host_start") {
          assert.ok(alive(leftovers.listener.pid));
          await hygiene.janitor(
            createKernelAgentHostControlPort(f.kernel, f.host),
            "host_start",
          );
        }
        const [row] = cleanupRows(f.kernel, f.roomId);
        assert.equal(row?.trigger, scenario);
        assert.equal(row?.foundCount, 2);
        assert.equal(row?.killedCount, 2);
        assert.equal(row?.remainingCount, 0);
        assert.deepEqual(row?.releasedPorts, [leftovers.listener.port]);
        assert.equal(alive(leftovers.listener.pid), false);
        assert.equal(alive(leftovers.detached.pid), false);
        assert.equal(await portOpen(leftovers.listener.port), false);
      } finally {
        for (const pid of [leftovers?.listener.pid, leftovers?.detached.pid])
          if (pid !== undefined)
            try {
              process.kill(pid, "SIGKILL");
            } catch {
              // already gone
            }
        if (existsSync(f.directory)) f.cleanup();
      }
    },
  );
}

// ---------------------------------------------------------------------------
// S2-0 independent review (2026-09-24) regressions.

type HygieneControl = ReturnType<typeof createKernelAgentHostControlPort>;

for (const order of ["a-then-b", "b-then-a"] as const)
  test(`S2-0 review P1-1: one runtime's clean sweep never admits past another's leftovers (${order})`, async () => {
    const f = fixture(`agg-${order}`);
    try {
      const sweeper = new ScriptedSweeper();
      let aStuck = true;
      sweeper.next = (ids) =>
        ids.has("runtime-a") && aStuck
          ? sweepResult({ found: 1, remaining: 1 })
          : sweepResult();
      const hygiene = new RuntimeProcessHygiene({
        onAlert: () => undefined,
        sweeper,
      });
      const control = createKernelAgentHostControlPort(f.kernel, f.host);
      const sweepRuntime = (runtimeId: string) =>
        hygiene.afterRuntime(control, {
          participantId: f.agentId,
          runtimeId,
          trigger: "runtime_crash",
        });
      for (const runtimeId of order === "a-then-b"
        ? ["runtime-a", "runtime-b"]
        : ["runtime-b", "runtime-a"])
        await sweepRuntime(runtimeId);
      const blocked = await hygiene.admit(control, f.agentId);
      assert.equal(blocked.blocked, true);
      assert.match(blocked.blocked ? blocked.reason : "", /runtime-a/u);
      aStuck = false;
      assert.deepEqual(await hygiene.admit(control, f.agentId), {
        blocked: false,
      });
    } finally {
      f.cleanup();
    }
  });

test("S2-0 review P1-1: the periodic janitor interleaved with afterRun never sweeps one runtime twice at once, and the newest observation decides", async () => {
  const f = fixture("interleave");
  try {
    const gates: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const sweeper = new ScriptedSweeper();
    sweeper.sweep = async (ids) => {
      sweeper.sweeps.push([...ids].sort());
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls += 1;
      const call = calls;
      await new Promise<void>((resolve) => gates.push(resolve));
      active -= 1;
      // The first (afterRun) sweep leaves one; the janitor's later one too.
      return call <= 2
        ? sweepResult({ found: 1, remaining: 1 })
        : sweepResult();
    };
    let tick = Date.parse("2026-09-24T02:00:00.000Z");
    const hygiene = new RuntimeProcessHygiene({
      now: () => new Date((tick += 1_000)),
      onAlert: () => undefined,
      sweeper,
    });
    const control = createKernelAgentHostControlPort(f.kernel, f.host);
    const afterRun = hygiene.afterRuntime(control, {
      participantId: f.agentId,
      runtimeId: "runtime-r",
      trigger: "run_end",
    });
    while (gates.length === 0) await new Promise((r) => setImmediate(r));
    // The janitor finds runtime-r pending and wants to re-sweep it.
    const janitor = hygiene.janitor(control, "janitor");
    for (let index = 0; index < 20; index += 1)
      await new Promise((r) => setImmediate(r));
    assert.equal(active, 1, "the janitor waits for the running sweep");
    gates.shift()!();
    while (gates.length === 0) await new Promise((r) => setImmediate(r));
    gates.shift()!();
    await Promise.all([afterRun, janitor]);
    assert.equal(maxActive, 1);
    assert.equal(
      (await control.readRuntimeCleanupAdmission!({ participantId: f.agentId }))
        .blocked,
      true,
    );
  } finally {
    f.cleanup();
  }
});

test("S2-0 review P1-1: a participant-only janitor with nothing tagged never clears a live resource-cap block", async () => {
  const f = fixture("cap-live");
  try {
    const sweeper = new ScriptedSweeper();
    sweeper.footprint = {
      listeningPorts: [3000, 3001, 3002],
      portsObserved: true,
      processCount: 3,
      rssKb: 10,
    };
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const runtime = new FakeRuntimeAdapter({
      onReap: async () => {
        await released;
        return { code: 0 };
      },
      onStart: f.acknowledge,
    });
    const control = createKernelAgentHostControlPort(f.kernel, f.host);
    let whileBusy:
      Promise<Awaited<ReturnType<RuntimeProcessHygiene["admit"]>>> | undefined;
    const hygiene: RuntimeProcessHygiene = new RuntimeProcessHygiene({
      capCheckIntervalMs: 1,
      caps: { maxListeningPorts: 2 },
      onAlert: () => {
        whileBusy = hygiene.admit(control, f.agentId).finally(release);
      },
      sweeper,
    });
    const host = new AgentHost({
      host: f.host,
      kernel: f.kernel,
      leaseMs: 30_000,
      processHygiene: hygiene,
      runtime,
    });
    f.post();
    assert.equal((await host.reconcileOnce()).state, "completed");
    const admission = await whileBusy!;
    assert.equal(admission.blocked, true);
    assert.match(admission.blocked ? admission.reason : "", /listening_ports/u);
  } finally {
    f.cleanup();
  }
});

test("S2-0 review P1-2: a failed cleanup record write fences admission until the retry succeeds", async () => {
  const f = fixture("record-fail");
  try {
    const sweeper = new ScriptedSweeper();
    sweeper.next = () => sweepResult({ found: 1, killed: 1 });
    const hygiene = new RuntimeProcessHygiene({
      onAlert: () => undefined,
      sweeper,
    });
    const real = createKernelAgentHostControlPort(f.kernel, f.host);
    let failing = true;
    const control: HygieneControl = {
      ...real,
      markRuntimeCleanupPending: async (input) => {
        if (failing) throw new Error("kernel unavailable");
        return await real.markRuntimeCleanupPending!(input);
      },
      recordRuntimeProcessCleanup: async (input) => {
        if (failing) throw new Error("kernel unavailable");
        return await real.recordRuntimeProcessCleanup!(input);
      },
    };
    // Never throws into the run's own outcome.
    await hygiene.afterRuntime(control, {
      participantId: f.agentId,
      runtimeId: "runtime-w",
      trigger: "run_end",
    });
    const fenced = await hygiene.admit(control, f.agentId);
    assert.equal(fenced.blocked, true);
    assert.match(
      fenced.blocked ? fenced.reason : "",
      /RAH_RUNTIME_CLEANUP_BLOCKED: .*not recorded/u,
    );
    failing = false;
    assert.deepEqual(await hygiene.admit(control, f.agentId), {
      blocked: false,
    });
    assert.equal(sweeper.sweeps.length, 1, "the recorded result is retried");
  } finally {
    f.cleanup();
  }
});

test("S2-0 review P1-2: a Host that dies after marking a cleanup pending leaves the runtime blocked until a sweep is recorded", async () => {
  const f = fixture("pending-crash");
  try {
    const control = createKernelAgentHostControlPort(f.kernel, f.host);
    await control.markRuntimeCleanupPending!({
      observedAt: new Date().toISOString(),
      participantId: f.agentId,
      runtimeRunId: "runtime-lost",
    });
    // A new Host process (fresh hygiene) re-sweeps the pending runtime.
    const sweeper = new ScriptedSweeper();
    const hygiene = new RuntimeProcessHygiene({ sweeper });
    assert.deepEqual(await hygiene.admit(control, f.agentId), {
      blocked: false,
    });
    assert.deepEqual(sweeper.sweeps, [["runtime-lost"]]);
  } finally {
    f.cleanup();
  }
});

test("S2-0 review P1-2: a ps failure blocks admission and a later successful sweep unblocks", async () => {
  const f = fixture("ps-fail");
  try {
    const sweeper = new ScriptedSweeper();
    let psDown = true;
    sweeper.next = () => {
      if (psDown) throw new Error("ps: timed out");
      return sweepResult();
    };
    const hygiene = new RuntimeProcessHygiene({
      onAlert: () => undefined,
      sweeper,
    });
    const control = createKernelAgentHostControlPort(f.kernel, f.host);
    await hygiene.afterRuntime(control, {
      participantId: f.agentId,
      runtimeId: "runtime-ps",
      trigger: "run_end",
    });
    const blocked = await hygiene.admit(control, f.agentId);
    assert.match(blocked.blocked ? blocked.reason : "", /ps: timed out/u);
    psDown = false;
    assert.deepEqual(await hygiene.admit(control, f.agentId), {
      blocked: false,
    });
  } finally {
    f.cleanup();
  }
});

test("S2-0 review P1-2: a failed host-start scan is unknown, not empty, and blocks until a scan succeeds", async () => {
  const f = fixture("scan-fail");
  try {
    const sweeper = new ScriptedSweeper();
    let psDown = true;
    sweeper.taggedRuntimeIds = async () => {
      if (psDown) throw new Error("ps: exited 2");
      return new Set<string>();
    };
    const hygiene = new RuntimeProcessHygiene({ sweeper });
    const control = createKernelAgentHostControlPort(f.kernel, f.host);
    await assert.rejects(
      hygiene.janitor(control, "host_start"),
      /ps: exited 2/u,
    );
    const blocked = await hygiene.admit(control, f.agentId);
    assert.match(
      blocked.blocked ? blocked.reason : "",
      /process scan unavailable: ps: exited 2/u,
    );
    psDown = false;
    assert.deepEqual(await hygiene.admit(control, f.agentId), {
      blocked: false,
    });
  } finally {
    f.cleanup();
  }
});

test("S2-0 review P2-2: an early start failure releases the notice; a failed run without acceptance redelivers it; acceptance consumes it", async () => {
  const f = fixture("notice");
  try {
    const sweeper = new ScriptedSweeper();
    sweeper.next = (ids) =>
      ids.has("fake-run-1")
        ? sweepResult({ found: 1, killed: 1, releasedPorts: [4000] })
        : sweepResult();
    let failStart = false;
    let confirm = false;
    const runtime = new FakeRuntimeAdapter({
      onStart: (input) => {
        if (failStart) {
          failStart = false;
          throw new Error("launch failed before the input was sent");
        }
        f.acknowledge(input);
      },
    });
    const confirming = {
      probe: () => runtime.probe(),
      reap: (run: Parameters<FakeRuntimeAdapter["reap"]>[0]) =>
        runtime.reap(run),
      cancel: (run: Parameters<FakeRuntimeAdapter["cancel"]>[0]) =>
        runtime.cancel(run),
      async start(
        input: Parameters<FakeRuntimeAdapter["start"]>[0],
        lifecycle: Parameters<FakeRuntimeAdapter["start"]>[1],
      ) {
        const run = await runtime.start(input, lifecycle);
        if (confirm && input.runtimeNotice !== undefined)
          await lifecycle.recordRuntimeNoticeAccepted?.();
        return run;
      },
    };
    const host = new AgentHost({
      host: f.host,
      kernel: f.kernel,
      leaseMs: 30_000,
      processHygiene: new RuntimeProcessHygiene({ sweeper }),
      retryAfterMs: 0,
      runtime: confirming,
    });
    f.post();
    assert.equal((await host.reconcileOnce()).state, "completed");
    // Run 2 fails to launch: its reserved notice goes back.
    failStart = true;
    f.post();
    assert.equal((await host.reconcileOnce()).state, "failed");
    const notice = runtime.starts[1]?.runtimeNotice;
    assert.match(notice ?? "", /port 4000/u);
    // Run 3 gets the same line, then exits non-zero without confirming.
    runtime.enqueueExit({ code: 3 });
    assert.equal((await host.reconcileOnce()).state, "failed");
    assert.equal(runtime.starts[2]?.runtimeNotice, notice);
    // Run 4 confirms acceptance and then fails: consumed anyway.
    confirm = true;
    runtime.enqueueExit({ code: 3 });
    assert.equal((await host.reconcileOnce()).state, "failed");
    assert.equal(runtime.starts[3]?.runtimeNotice, notice);
    f.post();
    await host.reconcileOnce();
    assert.equal(runtime.starts[4]?.runtimeNotice, undefined);
  } finally {
    f.cleanup();
  }
});
