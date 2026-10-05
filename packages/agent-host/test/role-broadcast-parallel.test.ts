import assert from "node:assert/strict";
import test from "node:test";
import { RoomKernel } from "@rah-os/kernel";
import { roleInstanceFixture } from "../../kernel/test/role-instance-fixture.ts";
import {
  FakeRuntimeAdapter,
  MultiLaneAgentHost,
  type ActivationEnvelope,
} from "../src/index.ts";

test("Human @all runs three real Role instances independently; busy A does not block B/C and directed A does not restart them", async () => {
  const f = roleInstanceFixture();
  // This integration explicitly permits two lanes; the reusable Kernel-only
  // fixture defaults to host capacity one. Reuse its real durable Role data.
  const kernel = new RoomKernel({
    databasePath: String(f.db.prepare("PRAGMA database_list").get()!.file),
    placementCapacityPolicy: { defaultMaxConcurrent: 2 },
  });
  kernel.initialize();
  f.kernel = kernel;
  const ids = [f.instance.instanceId];
  for (const name of ["B", "C"])
    ids.push(
      f.kernel.roles.instantiate(f.actor, {
        roleId: f.role.roleId,
        channelId: f.home.roomId,
        basedOnRoomSeq: f.head(f.home.roomId),
        idempotencyKey: `instance-${name}`,
      }).instance.instanceId,
    );
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const consume = (input: ActivationEnvelope) => {
    const execution = f.kernel.authorizeWorkerExecution(f.host, {
      activationId: input.activationId,
      consumerId: input.consumerId,
      hostId: input.hostId,
      participantId: input.participantId,
      roomId: input.roomId,
      runAttemptId: input.runAttemptId,
      toSeq: input.toSeq,
    });
    const delivered = f.kernel.syncWorker(execution, {});
    f.kernel.acknowledgeWorkerCursor(execution, {
      throughSeq: delivered.cursorAfter,
    });
  };
  const runtime = new FakeRuntimeAdapter({
    onStart: consume,
    onReap: async (run) => {
      const start =
        runtime.starts[Number(run.runId.replace("fake-run-", "")) - 1]!;
      if (start.participantId === ids[0]) await blocked;
      return { code: 0 };
    },
  });
  const runtimes = ids.map((id) => ({
    get starts() {
      return runtime.starts.filter((s) => s.participantId === id);
    },
  }));
  const host = new MultiLaneAgentHost({
    capacity: 2,
    host: f.host,
    kernel: f.kernel,
    runtime,
    placementRuntimeResolver: () => runtime,
    leaseMs: 30_000,
    leaseRenewIntervalMs: 20,
    pollIntervalMs: 5,
    retryAfterMs: 0,
    runtimeStartScheduler: { maxConcurrentStarts: 2, minStartIntervalMs: 0 },
  });
  const control = new AbortController();
  let running: Promise<void> | undefined;
  let runError: unknown;
  const waitFor = async (predicate: () => boolean) => {
    const until = Date.now() + 5000;
    while (!predicate()) {
      if (runError) throw runError;
      assert.ok(
        Date.now() < until,
        JSON.stringify({
          starts: runtimes.map((r) => r.starts.length),
          activations: f.kernel.listActivations({ roomId: f.home.roomId }),
          runs: f.kernel.listRunAttempts({ roomId: f.home.roomId }),
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  try {
    f.kernel.postRoomMessage(f.actor, {
      roomId: f.home.roomId,
      body: "@all FAKE broadcast",
      idempotencyKey: "broadcast",
    });
    assert.deepEqual(
      new Set(
        f.kernel
          .listActivations({ roomId: f.home.roomId })
          .map((a) => a.participantId),
      ),
      new Set(ids),
    );
    running = host.run({ signal: control.signal });
    void running.catch((error) => {
      runError = error;
    });
    await waitFor(
      () =>
        runtimes.every((r) => r.starts.length === 1) &&
        f.kernel
          .listActivations({ roomId: f.home.roomId })
          .filter((a) => a.state === "completed").length === 2,
    );
    const activeA = f.kernel
      .listActivations({ roomId: f.home.roomId })
      .find((a) => a.participantId === ids[0]);
    assert.equal(
      activeA?.state,
      "leased",
      "B/C complete while A still owns its lane",
    );
    const handle = f.db
      .prepare("SELECT handle FROM principals WHERE principal_id=?")
      .get(ids[0]!)!.handle;
    f.kernel.postRoomMessage(f.actor, {
      roomId: f.home.roomId,
      body: `@${String(handle)} FAKE directed follow-up`,
      idempotencyKey: "directed",
    });
    const queued = f.kernel
      .listActivations({ roomId: f.home.roomId })
      .filter((a) => a.state === "queued");
    assert.equal(queued.length, 1);
    assert.equal(queued[0]!.participantId, ids[0]);
    assert.deepEqual(
      runtimes.map((r) => r.starts.length),
      [1, 1, 1],
      "busy A cannot acquire a second lane",
    );
    release();
    await waitFor(() =>
      f.kernel
        .listActivations({ roomId: f.home.roomId })
        .every((a) => a.state === "completed"),
    );
    assert.deepEqual(
      runtimes.map((r) => r.starts.length),
      [2, 1, 1],
    );
    assert.equal(f.kernel.listRunAttempts({ roomId: f.home.roomId }).length, 4);
    assert.equal(runError, undefined);
  } finally {
    release();
    control.abort();
    if (running) await running;
    kernel.close();
    f.close();
  }
});
