import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  startLocalCoreWorkbench,
  type RunningLocalCoreWorkbench,
} from "./local-core-workbench.ts";
import type { WorkbenchServiceControl } from "./workbench-service-control.ts";

/** Outer launcher survives; Core, Host and gateway are fully stopped and recreated. */
export async function startRestartableLocalCoreWorkbench(
  input: Parameters<typeof startLocalCoreWorkbench>[0],
  lifecycle = {
    start: startLocalCoreWorkbench,
    wait: () => new Promise<void>((resolve) => setTimeout(resolve, 1000)),
  },
): Promise<RunningLocalCoreWorkbench> {
  let generation = randomUUID();
  let state: "online" | "restarting" | "failed" = "online";
  let stopped = false;
  let pending: Promise<void> | undefined;
  let running: RunningLocalCoreWorkbench;
  let mode = input.mode;
  let fail!: (error: Error) => void;
  const failed = new Promise<Error>((resolve) => {
    fail = resolve;
  });
  const observeFailure = (owner: RunningLocalCoreWorkbench) => {
    void owner.failed?.then((error) => {
      if (stopped || owner !== running || state !== "online") return;
      state = "failed";
      fail(error);
    });
  };
  const serviceControl: WorkbenchServiceControl = {
    status: () => ({ generation, state }),
    restart(expected) {
      if (expected !== generation || stopped || state === "failed")
        return "stale";
      if (state === "restarting") return "accepted";
      if (!workbenchIsIdle(running.descriptor.stateDirectory)) return "busy";
      state = "restarting";
      // The operation belongs to the launcher, never to the HTTP connection.
      pending = new Promise<void>((resolve) => setImmediate(resolve))
        .then(async () => {
          await running.stop();
          for (let attempt = 0; attempt < 2 && !stopped; attempt += 1) {
            try {
              running = await lifecycle.start({
                ...input,
                mode,
                serviceControl,
              });
              generation = randomUUID();
              state = "online";
              observeFailure(running);
              return;
            } catch (error) {
              // startLocalCoreWorkbench rolls back every partially started owner.
              // Recheck durable execution evidence; never retry past an orphan or hold.
              if (
                attempt > 0 ||
                !workbenchIsIdle(running.descriptor.stateDirectory)
              )
                throw error;
              await lifecycle.wait();
              if (!workbenchIsIdle(running.descriptor.stateDirectory))
                throw error;
            }
          }
        })
        .catch((error: unknown) => {
          state = "failed";
          process.stderr.write(`Workbench restart failed: ${String(error)}\n`);
          fail(
            error instanceof Error
              ? error
              : new Error("Workbench restart failed"),
          );
        });
      return "accepted";
    },
  };
  running = await lifecycle.start({ ...input, serviceControl });
  observeFailure(running);
  if (mode.kind === "loopback" || mode.kind === "tailnet")
    mode = {
      ...mode,
      port: Number(new URL(running.descriptor.webOrigin).port),
    };
  return {
    failed,
    get descriptor() {
      return running.descriptor;
    },
    async stop() {
      stopped = true;
      await pending;
      await running.stop();
    },
  };
}

/** Read-only deployment guard; durable execution owners remain in Kernel/Host. */
function workbenchIsIdle(stateDirectory: string): boolean {
  const db = new DatabaseSync(join(stateDirectory, "room.db"), {
    readOnly: true,
  });
  try {
    for (const [table, predicate] of [
      ["activations", "state IN ('queued','leased','quarantined')"],
      ["run_attempts", "state IN ('starting','running','orphaned')"],
      ["runtime_processes", "state != 'terminated'"],
      ["placements", "state != 'released'"],
      ["agent_exclusive_operation_leases", "state = 'active'"],
    ]) {
      if (
        db
          .prepare(`SELECT count(*) AS n FROM ${table} WHERE ${predicate}`)
          .get()?.n !== 0
      )
        return false;
    }
    return true;
  } finally {
    db.close();
  }
}
