import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  startLocalCoreWorkbench,
  type RunningLocalCoreWorkbench,
} from "./local-core-workbench.ts";
import type { WorkbenchServiceControl } from "./workbench-service-control.ts";
import { startCliUpdateWatcher } from "./cli-update-watcher.ts";

/** Outer launcher survives; Core, Host and gateway are fully stopped and recreated. */
export async function startRestartableLocalCoreWorkbench(
  input: Parameters<typeof startLocalCoreWorkbench>[0],
  lifecycle: {
    start: typeof startLocalCoreWorkbench;
    wait: () => Promise<void>;
    /** How often a CLI launcher is re-resolved (owner ruling 2026-09-28). */
    watchIntervalMs?: number;
  } = {
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
      return beginRestart(expected, "strict");
    },
  };
  // One restart body for the operator route (strict: nothing queued either)
  // and the CLI-update watcher (durable queued/quarantined work survives a
  // restart and may be waiting for exactly this one; running work may not).
  function beginRestart(
    expected: string,
    idle: "strict" | "nothing-running",
  ): "accepted" | "stale" | "busy" {
    if (expected !== generation || stopped || state === "failed")
      return "stale";
    if (state === "restarting") return "accepted";
    if (!workbenchIsIdle(running.descriptor.stateDirectory, idle))
      return "busy";
    watcher?.stop();
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
            armWatcher();
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
  }
  let watcher: ReturnType<typeof startCliUpdateWatcher> | undefined;
  function armWatcher() {
    watcher?.stop();
    const identities = running.cliExecutables ?? [];
    if (identities.length === 0) return;
    const owner = generation;
    watcher = startCliUpdateWatcher({
      identities,
      intervalMs: lifecycle.watchIntervalMs ?? 60_000,
      requestRestart: () => beginRestart(owner, "nothing-running"),
      onChange: (cliId, from, to) =>
        process.stderr.write(
          `CLI ${cliId} launcher now resolves to ${to} (was ${from}); restarting when nothing runs\n`,
        ),
    });
  }
  running = await lifecycle.start({ ...input, serviceControl });
  observeFailure(running);
  armWatcher();
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
      watcher?.stop();
      await pending;
      await running.stop();
    },
  };
}

/** Read-only deployment guard; durable execution owners remain in Kernel/Host. */
function workbenchIsIdle(
  stateDirectory: string,
  idle: "strict" | "nothing-running" = "strict",
): boolean {
  const db = new DatabaseSync(join(stateDirectory, "room.db"), {
    readOnly: true,
  });
  try {
    for (const [table, predicate] of [
      [
        "activations",
        idle === "strict"
          ? "state IN ('queued','leased','quarantined')"
          : "state = 'leased'",
      ],
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
