import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { startRestartableLocalCoreWorkbench } from "../src/restartable-local-workbench.ts";
import type { WorkbenchServiceControl } from "../src/workbench-service-control.ts";

for (const outcome of [
  "recover",
  "persistent-failure",
  "guarded",
  "guarded-after-wait",
  "cancelled",
] as const) {
  test(`restart successor startup ${outcome} is bounded and preserves the execution guard`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "rah-successor-recovery-"));
    const db = new DatabaseSync(join(directory, "room.db"));
    for (const table of [
      "activations",
      "run_attempts",
      "runtime_processes",
      "placements",
      "agent_exclusive_operation_leases",
    ])
      db.exec(`CREATE TABLE ${table} (state TEXT)`);
    let control: WorkbenchServiceControl | undefined;
    let starts = 0;
    let stops = 0;
    let waits = 0;
    try {
      const running = await startRestartableLocalCoreWorkbench(
        {
          mode: { kind: "loopback", port: 0 },
          staticDirectory: directory,
          workbenchHome: directory,
          workspaceCwd: directory,
        },
        {
          async start(input) {
            control = input.serviceControl;
            starts += 1;
            if (starts > 1 && (starts === 2 || outcome !== "recover")) {
              if (outcome === "guarded")
                db.exec("INSERT INTO run_attempts VALUES ('orphaned')");
              throw new Error(
                "injected successor startup failure after rollback",
              );
            }
            let stopped = false;
            return {
              descriptor: {
                defaultRoomId: "room",
                persistent: true,
                runtimes: [],
                stateDirectory: directory,
                webOrigin: "http://127.0.0.1:4199",
                workspaceCwd: directory,
                workspaceId: "workspace",
              },
              async stop() {
                if (stopped) return;
                stopped = true;
                stops += 1;
              },
            };
          },
          async wait() {
            waits += 1;
            if (outcome === "guarded-after-wait")
              db.exec("INSERT INTO activations VALUES ('quarantined')");
            if (outcome === "cancelled") void running.stop();
          },
        },
      );
      assert.ok(control);
      const before = control.status().generation;
      assert.equal(control.restart(before), "accepted");
      for (
        let turn = 0;
        turn < 20 && control.status().state === "restarting";
        turn += 1
      )
        await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(
        stops,
        1,
        "old owner was drained exactly once before replacement",
      );
      if (outcome === "recover") {
        assert.equal(
          starts,
          3,
          "one failed successor is followed by one recovery attempt",
        );
        assert.equal(waits, 1);
        assert.equal(control.status().state, "online");
        assert.notEqual(control.status().generation, before);
        assert.equal(control.restart(before), "stale");
      } else if (outcome === "cancelled") {
        assert.equal(
          starts,
          2,
          "shutdown during recovery prevents a late successor",
        );
        assert.equal(control.status().generation, before);
        assert.equal(control.restart(before), "stale");
      } else {
        assert.equal(starts, outcome === "persistent-failure" ? 3 : 2);
        assert.equal(control.status().state, "failed");
        assert.equal(control.status().generation, before);
        assert.equal(
          control.restart(before),
          "stale",
          "failed startup is not a new accepted restart",
        );
        assert.ok(
          running.failed,
          "the outer launcher must receive a terminal failure instead of waiting forever",
        );
        assert.match(
          (await running.failed).message,
          /injected successor startup failure/,
        );
      }
      await running.stop();
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("running daemon failure reaches the outer launcher and marks service failed", async () => {
  let control: WorkbenchServiceControl | undefined;
  let fail!: (error: Error) => void;
  const childFailure = new Promise<Error>((resolve) => {
    fail = resolve;
  });
  const running = await startRestartableLocalCoreWorkbench(
    {
      mode: { kind: "loopback", port: 0 },
      staticDirectory: "/tmp/unused",
      workbenchHome: "/tmp/unused",
      workspaceCwd: "/tmp/unused",
    },
    {
      async start(input) {
        control = input.serviceControl;
        return {
          descriptor: {
            defaultRoomId: "room",
            persistent: true,
            runtimes: [],
            stateDirectory: "/tmp/unused",
            webOrigin: "http://127.0.0.1:4199",
            workspaceCwd: "/tmp/unused",
            workspaceId: "workspace",
          },
          failed: childFailure,
          async stop() {},
        };
      },
      async wait() {},
    },
  );
  let observed: Error | undefined;
  void running.failed?.then((error) => {
    observed = error;
  });
  const error = new Error("runner failed after startup");
  fail(error);
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  assert.equal(observed, error);
  assert.equal(control?.status().state, "failed");
  assert.equal(control?.restart(control.status().generation), "stale");
  await running.stop();
});

for (const scenario of ["queued-only", "running"] as const) {
  test(`a repointed CLI launcher restarts the workbench only when nothing runs (${scenario})`, async () => {
    const { realpathSync, symlinkSync, unlinkSync, writeFileSync } =
      await import("node:fs");
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "rah-cli-update-")),
    );
    const db = new DatabaseSync(join(directory, "room.db"));
    for (const table of [
      "activations",
      "run_attempts",
      "runtime_processes",
      "placements",
      "agent_exclusive_operation_leases",
    ])
      db.exec(`CREATE TABLE ${table} (state TEXT)`);
    // Durable queued work never blocks an update restart; running work does.
    db.exec("INSERT INTO activations VALUES ('queued')");
    if (scenario === "running")
      db.exec("INSERT INTO run_attempts VALUES ('running')");
    const v1 = join(directory, "1.0.0");
    const v2 = join(directory, "1.0.1");
    const launcher = join(directory, "claude");
    writeFileSync(v1, "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(v2, "#!/bin/sh\n", { mode: 0o755 });
    symlinkSync(v1, launcher);
    let starts = 0;
    try {
      const running = await startRestartableLocalCoreWorkbench(
        {
          mode: { kind: "loopback", port: 0 },
          staticDirectory: directory,
          workbenchHome: directory,
          workspaceCwd: directory,
        },
        {
          async start() {
            starts += 1;
            return {
              cliExecutables: [
                {
                  cliId: "claude",
                  launcherPath: launcher,
                  resolvedPath: realpathSync(launcher),
                },
              ],
              descriptor: {
                defaultRoomId: "room",
                persistent: true,
                runtimes: [],
                stateDirectory: directory,
                webOrigin: "http://127.0.0.1:4199",
                workspaceCwd: directory,
                workspaceId: "workspace",
              },
              async stop() {},
            };
          },
          async wait() {},
          watchIntervalMs: 5,
        },
      );
      unlinkSync(launcher);
      symlinkSync(v2, launcher);
      for (let turn = 0; turn < 60 && starts < 2; turn += 1)
        await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(
        starts,
        scenario === "running" ? 1 : 2,
        scenario === "running"
          ? "running work defers the update restart"
          : "the update restart picked up the new launcher target",
      );
      await running.stop();
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("review round 2 P1-1: an update restart with queued work recovers from one transient successor failure", async () => {
  const { realpathSync, symlinkSync, unlinkSync, writeFileSync } =
    await import("node:fs");
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "rah-cli-update-recover-")),
  );
  const db = new DatabaseSync(join(directory, "room.db"));
  for (const table of [
    "activations",
    "run_attempts",
    "runtime_processes",
    "placements",
    "agent_exclusive_operation_leases",
  ])
    db.exec(`CREATE TABLE ${table} (state TEXT)`);
  db.exec("INSERT INTO activations VALUES ('queued')");
  const v1 = join(directory, "1.0.0");
  const v2 = join(directory, "1.0.1");
  const launcher = join(directory, "claude");
  writeFileSync(v1, "#!/bin/sh\n", { mode: 0o755 });
  writeFileSync(v2, "#!/bin/sh\n", { mode: 0o755 });
  symlinkSync(v1, launcher);
  let starts = 0;
  let waits = 0;
  try {
    const running = await startRestartableLocalCoreWorkbench(
      {
        mode: { kind: "loopback", port: 0 },
        staticDirectory: directory,
        workbenchHome: directory,
        workspaceCwd: directory,
      },
      {
        async start() {
          starts += 1;
          if (starts === 2) throw new Error("temporary probe failure");
          return {
            cliExecutables: [
              {
                cliId: "claude",
                launcherPath: launcher,
                resolvedPath: realpathSync(launcher),
              },
            ],
            descriptor: {
              defaultRoomId: "room",
              persistent: true,
              runtimes: [],
              stateDirectory: directory,
              webOrigin: "http://127.0.0.1:4199",
              workspaceCwd: directory,
              workspaceId: "workspace",
            },
            async stop() {},
          };
        },
        async wait() {
          waits += 1;
        },
        watchIntervalMs: 5,
      },
    );
    unlinkSync(launcher);
    symlinkSync(v2, launcher);
    for (let turn = 0; turn < 80 && starts < 3; turn += 1)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(starts, 3, "one failed successor, then one recovery attempt");
    assert.equal(waits, 1);
    await running.stop();
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("review round 2 P1-2: work claimed between the idle check and the stop cancels the update restart instead of being interrupted", async () => {
  const { realpathSync, symlinkSync, unlinkSync, writeFileSync } =
    await import("node:fs");
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "rah-cli-update-barrier-")),
  );
  const db = new DatabaseSync(join(directory, "room.db"));
  for (const table of [
    "activations",
    "run_attempts",
    "runtime_processes",
    "placements",
    "agent_exclusive_operation_leases",
  ])
    db.exec(`CREATE TABLE ${table} (state TEXT)`);
  const v1 = join(directory, "1.0.0");
  const v2 = join(directory, "1.0.1");
  const launcher = join(directory, "claude");
  writeFileSync(v1, "#!/bin/sh\n", { mode: 0o755 });
  writeFileSync(v2, "#!/bin/sh\n", { mode: 0o755 });
  symlinkSync(v1, launcher);
  let starts = 0;
  let stops = 0;
  let pauses = 0;
  let resumes = 0;
  let raceOnce = true;
  try {
    const running = await startRestartableLocalCoreWorkbench(
      {
        mode: { kind: "loopback", port: 0 },
        staticDirectory: directory,
        workbenchHome: directory,
        workspaceCwd: directory,
      },
      {
        async start() {
          starts += 1;
          return {
            cliExecutables: [
              {
                cliId: "claude",
                launcherPath: launcher,
                resolvedPath: realpathSync(v1),
              },
            ],
            descriptor: {
              defaultRoomId: "room",
              persistent: true,
              runtimes: [],
              stateDirectory: directory,
              webOrigin: "http://127.0.0.1:4199",
              workspaceCwd: directory,
              workspaceId: "workspace",
            },
            async pauseAdmission() {
              pauses += 1;
              // A claim that raced the idle check lands before admission closes.
              if (raceOnce) {
                raceOnce = false;
                db.exec("INSERT INTO run_attempts VALUES ('running')");
              }
            },
            resumeAdmission() {
              resumes += 1;
            },
            async stop() {
              stops += 1;
            },
          };
        },
        async wait() {},
        watchIntervalMs: 5,
      },
    );
    unlinkSync(launcher);
    symlinkSync(v2, launcher);
    for (let turn = 0; turn < 60 && resumes < 1; turn += 1)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(resumes, 1, "the raced claim reopened admission");
    assert.equal(stops, 0, "the running work was not interrupted");
    assert.equal(starts, 1);
    // The raced run finishes; the next tick performs the update restart.
    db.exec("DELETE FROM run_attempts");
    for (let turn = 0; turn < 80 && starts < 2; turn += 1)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(starts, 2);
    assert.equal(stops, 1);
    assert.ok(pauses >= 2);
    await running.stop();
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
