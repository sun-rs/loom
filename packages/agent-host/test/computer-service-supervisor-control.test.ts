import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ComputerServiceSupervisor,
  createComputerServiceOwnershipProofToken,
  createComputerServiceSupervisorControlHandler,
  NodeComputerServiceSupervisorControlClient,
  UnixSocketInstanceLock,
  type SupervisedComputerServiceProcess,
} from "../src/index.ts";

test("authenticated supervisor control performs one fenced stable-to-experiment handoff", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "rah-sup-ctl-"));
  context.after(
    async () => await rm(directory, { force: true, recursive: true }),
  );
  const token = createComputerServiceOwnershipProofToken();
  const children: FakeProcess[] = [];
  const supervisor = new ComputerServiceSupervisor({
    launch: async (slot) => {
      const child = new FakeProcess(800 + children.length, slot);
      children.push(child);
      return child;
    },
  });
  await supervisor.start();
  const lock = new UnixSocketInstanceLock({
    directory,
    handleConnection: createComputerServiceSupervisorControlHandler({
      controlToken: token,
      supervisor,
    }),
    hostId: "sup-ctl",
  });
  await lock.acquire();
  context.after(async () => {
    await lock.release();
    await supervisor.close();
  });
  const client = new NodeComputerServiceSupervisorControlClient({
    controlToken: token,
    socketPath: lock.socketPath,
    timeoutMs: 1_000,
  });

  assert.deepEqual(await client.readStatus(), {
    kind: "running",
    processId: 800,
    slot: "stable",
  });
  assert.deepEqual(await client.stopForHandoff({ expectedProcessId: 800 }), {
    kind: "handoff_waiting",
  });
  assert.deepEqual(await client.startForHandoff("experiment"), {
    kind: "running",
    processId: 801,
    slot: "experiment",
  });
  assert.deepEqual(await client.readStatus(), {
    kind: "running",
    processId: 801,
    slot: "experiment",
  });
  await assert.rejects(
    new NodeComputerServiceSupervisorControlClient({
      controlToken: createComputerServiceOwnershipProofToken(),
      socketPath: lock.socketPath,
      timeoutMs: 1_000,
    }).stopForHandoff({ expectedProcessId: 801 }),
    /request was rejected/u,
  );
  assert.equal(supervisor.snapshot().kind, "running");
});

test("supervisor control fences a stale process id before stop", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "rah-sup-fence-"));
  context.after(
    async () => await rm(directory, { force: true, recursive: true }),
  );
  const token = createComputerServiceOwnershipProofToken();
  const child = new FakeProcess(910, "stable");
  const supervisor = new ComputerServiceSupervisor({
    launch: async () => child,
  });
  await supervisor.start();
  const lock = new UnixSocketInstanceLock({
    directory,
    handleConnection: createComputerServiceSupervisorControlHandler({
      controlToken: token,
      supervisor,
    }),
    hostId: "sup-fence",
  });
  await lock.acquire();
  context.after(async () => {
    await lock.release();
    await supervisor.close();
  });
  const client = new NodeComputerServiceSupervisorControlClient({
    controlToken: token,
    socketPath: lock.socketPath,
    timeoutMs: 1_000,
  });
  await assert.rejects(
    client.stopForHandoff({ expectedProcessId: 909 }),
    /request was rejected/u,
  );
  assert.equal(child.stopRequests, 0);
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

  async requestStop(): Promise<void> {
    this.stopRequests += 1;
    this.#exit({ code: 0, signal: null });
  }
}
