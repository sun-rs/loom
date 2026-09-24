import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  GenericProcessAdapter,
  LeftoverProcessSweeper,
  createSystemProcessTable,
  type ActivationEnvelope,
  type ProcessIdentity,
  type ProcessRecord,
  type ProcessTable,
} from "../src/index.ts";

const leftoverCliPath = fileURLToPath(
  new URL("./fixtures/leftover-cli.mjs", import.meta.url),
);
const UID = 501;
const SELF = 10;

type FakeProcess = ProcessRecord & {
  ignoresTerm?: boolean;
  unkillable?: boolean;
  ports?: number[];
};

class FakeProcessTable implements ProcessTable {
  readonly processes = new Map<number, FakeProcess>();
  readonly signals: Array<[number, string]> = [];
  /** pid -> identity to substitute after the first scan (PID reuse). */
  readonly reuseAfterScan = new Map<number, FakeProcess>();
  #scanned = false;

  add(process: Partial<FakeProcess> & { pid: number }): void {
    this.processes.set(process.pid, {
      command: `proc-${process.pid}`,
      pgid: process.pid,
      ppid: 1,
      rssKb: 1_000,
      startedAt: `start-${process.pid}`,
      uid: UID,
      ...process,
    });
  }

  async list(): Promise<ProcessRecord[]> {
    const listed = [...this.processes.values()].map((entry) => ({ ...entry }));
    if (!this.#scanned) {
      this.#scanned = true;
      for (const [pid, replacement] of this.reuseAfterScan)
        this.processes.set(pid, replacement);
    }
    return listed;
  }

  async identities(
    pids: readonly number[],
  ): Promise<Map<number, ProcessIdentity>> {
    const result = new Map<number, ProcessIdentity>();
    for (const pid of pids) {
      const entry = this.processes.get(pid);
      if (entry)
        result.set(pid, {
          pid,
          startedAt: entry.startedAt,
          uid: entry.uid,
        });
    }
    return result;
  }

  async listeningPorts(
    pids: readonly number[],
  ): Promise<Map<number, number[]>> {
    const result = new Map<number, number[]>();
    for (const pid of pids) {
      const ports = this.processes.get(pid)?.ports;
      if (ports?.length) result.set(pid, [...ports]);
    }
    return result;
  }

  signal(pid: number, signal: NodeJS.Signals): void {
    this.signals.push([pid, signal]);
    const entry = this.processes.get(pid);
    if (!entry || entry.unkillable) return;
    if (signal === "SIGTERM" && entry.ignoresTerm) return;
    this.processes.delete(pid);
  }
}

function sweeper(table: ProcessTable) {
  return new LeftoverProcessSweeper({
    graceMs: 20,
    killWaitMs: 20,
    pollMs: 1,
    selfPid: SELF,
    table,
    uid: UID,
  });
}

test("S2-0 sweeper kills only processes tagged with the dead runtime and their descendants", async () => {
  const table = new FakeProcessTable();
  table.add({ pid: SELF, runtimeId: "process:dead" }); // never itself
  table.add({
    pid: 20,
    runtimeId: "process:dead",
    runId: "run-1",
    ports: [3000],
  });
  table.add({ pid: 21, ppid: 20, pgid: 20 }); // untagged child (env cleared)
  table.add({ pid: 22, pgid: 20, ppid: 1 }); // reparented group member
  table.add({ pid: 30, runtimeId: "process:live" });
  table.add({ pid: 40 }); // untagged, unrelated
  table.add({ pid: 50, runtimeId: "process:dead", uid: 0 }); // other user
  table.add({ pid: 60, ignoresTerm: true, runtimeId: "process:dead" });

  const result = await sweeper(table).sweep(new Set(["process:dead"]));

  assert.deepEqual(
    [...table.processes.keys()].sort((a, b) => a - b),
    [SELF, 30, 40, 50],
  );
  assert.equal(result.found, 4);
  assert.equal(result.killed, 4);
  assert.equal(result.remaining, 0);
  assert.deepEqual(result.releasedPorts, [3000]);
  assert.deepEqual(result.remainingPorts, []);
  assert.ok(table.signals.some(([pid, s]) => pid === 60 && s === "SIGKILL"));
  assert.ok(!table.signals.some(([pid]) => [SELF, 30, 40, 50].includes(pid)));
});

test("S2-0 sweeper re-verifies identity before signalling (PID reuse)", async () => {
  const table = new FakeProcessTable();
  table.add({ pid: 20, runtimeId: "process:dead" });
  // Between the scan and the signal pid 20 exits and is reused.
  table.reuseAfterScan.set(20, {
    command: "unrelated",
    pgid: 20,
    pid: 20,
    ppid: 1,
    rssKb: 1,
    startedAt: "later",
    uid: UID,
  });

  const result = await sweeper(table).sweep(new Set(["process:dead"]));

  assert.equal(table.signals.length, 0);
  assert.ok(table.processes.has(20));
  assert.equal(result.found, 1);
  assert.equal(result.killed, 0);
  assert.equal(result.remaining, 0);
});

test("S2-0 sweeper reports a process it could not kill as remaining", async () => {
  const table = new FakeProcessTable();
  table.add({
    pid: 20,
    ports: [5173],
    runtimeId: "process:dead",
    unkillable: true,
  });
  const result = await sweeper(table).sweep(new Set(["process:dead"]));
  assert.equal(result.found, 1);
  assert.equal(result.killed, 0);
  assert.equal(result.remaining, 1);
  assert.deepEqual(result.releasedPorts, []);
  assert.deepEqual(result.remainingPorts, [5173]);
});

test("S2-0 sweeper measures a live runtime footprint without signalling", async () => {
  const table = new FakeProcessTable();
  table.add({
    pid: 20,
    ports: [3000, 3001],
    rssKb: 2_000,
    runtimeId: "process:live",
  });
  table.add({ pid: 21, ppid: 20, rssKb: 500 });
  const footprint = await sweeper(table).measure(new Set(["process:live"]));
  assert.deepEqual(footprint, {
    listeningPorts: [3000, 3001],
    processCount: 2,
    rssKb: 2_500,
  });
  assert.equal(table.signals.length, 0);
  const tagged = await sweeper(table).taggedRuntimeIds();
  assert.deepEqual([...tagged], ["process:live"]);
});

function activationEnvelope(runAttemptId: string): ActivationEnvelope {
  return {
    activationId: "activation-leftover",
    consumerId: "leftover:runtime",
    fromSeq: 1,
    hostId: "leftover-host",
    participantId: "agent-leftover",
    reason: "mention",
    roomId: "room-leftover",
    runAttemptId,
    toSeq: 2,
  };
}

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

const realProcesses =
  process.platform === "darwin" || process.platform === "linux";

{
  test(
    "S2-0 real supervised run: detached grandchildren inherit the tags and are cleaned after exit",
    { skip: !realProcesses },
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "rah-os-leftover-"));
      const report = join(directory, "report.json");
      let pids: number[] = [];
      try {
        const adapter = new GenericProcessAdapter({
          args: [leftoverCliPath],
          command: process.execPath,
          cwd: directory,
          env: { RAH_LEFTOVER_EXIT: "3", RAH_LEFTOVER_REPORT: report },
          supervisorDirectory: join(directory, "supervisors"),
          terminationGraceMs: 200,
        });
        const run = await adapter.start(
          activationEnvelope("run-leftover-real"),
          { registerPrepared: async () => undefined },
        );
        const exit = await adapter.reap(run);
        assert.equal(exit.code, 3);
        const leftovers = JSON.parse(readFileSync(report, "utf8")) as {
          detached: { pid: number };
          listener: {
            pid: number;
            port: number;
            runId: string | null;
            runtimeId: string | null;
          };
        };
        pids = [leftovers.detached.pid, leftovers.listener.pid];
        assert.equal(leftovers.listener.runtimeId, run.runId);
        assert.equal(leftovers.listener.runId, "run-leftover-real");
        // The group kill that ended the run did not reach them.
        assert.ok(alive(leftovers.listener.pid));
        assert.ok(alive(leftovers.detached.pid));
        assert.equal(await portOpen(leftovers.listener.port), true);

        // An untagged detached process of the same user is never touched.
        const bystander = spawn(
          process.execPath,
          ["-e", "setInterval(() => {}, 1000)"],
          { detached: true, stdio: "ignore", env: { PATH: process.env.PATH } },
        );
        bystander.unref();
        pids.push(bystander.pid!);

        const result = await new LeftoverProcessSweeper({
          graceMs: 300,
          table: createSystemProcessTable(),
        }).sweep(new Set([run.runId]));

        assert.equal(result.found, 2);
        assert.equal(result.killed, 2);
        assert.equal(result.remaining, 0);
        assert.deepEqual(result.releasedPorts, [leftovers.listener.port]);
        assert.equal(alive(leftovers.listener.pid), false);
        assert.equal(alive(leftovers.detached.pid), false);
        assert.equal(await portOpen(leftovers.listener.port), false);
        assert.equal(alive(bystander.pid!), true);
      } finally {
        for (const pid of pids) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            // already gone
          }
        }
        if (existsSync(directory))
          rmSync(directory, { force: true, recursive: true });
      }
    },
  );
}
