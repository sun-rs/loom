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
