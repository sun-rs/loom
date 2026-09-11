import assert from "node:assert/strict";
import test from "node:test";
import type { AgentHostControlPort } from "../src/agent-host-control.ts";
import { maintainRuntimeBusyNotices } from "../src/runtime-busy-notices.ts";
import type { RuntimeAdapter, RuntimeBusyNotice } from "../src/runtime.ts";

const notice: RuntimeBusyNotice = {
  fingerprint: "a".repeat(64),
  text: "Inbox update: #room · latest msg=message-new",
};

function fixture(
  options: {
    iterations?: number;
    supported?: boolean;
    read?: (
      iteration: number,
      abort: AbortController,
    ) => Promise<RuntimeBusyNotice | undefined>;
    notify?: (iteration: number) => Promise<boolean>;
  } = {},
) {
  const abort = new AbortController();
  const sent: RuntimeBusyNotice[] = [];
  let reads = 0;
  let waits = 0;
  const unexpected = () => {
    throw new Error(
      "notice maintenance must not mutate lifecycle or Room state",
    );
  };
  // A proxy deliberately rejects every lifecycle/mutation method: this is a
  // read-only transport hint loop, not a second scheduler or acknowledgement.
  const control = new Proxy(
    {
      async readPendingRuntimeNotice(input: {
        activationId: string;
        runAttemptId: string;
      }) {
        assert.deepEqual(input, {
          activationId: "activation",
          runAttemptId: "attempt",
        });
        reads++;
        return options.read ? await options.read(reads, abort) : notice;
      },
    },
    {
      get(target, key) {
        return key === "readPendingRuntimeNotice"
          ? target.readPendingRuntimeNotice
          : unexpected;
      },
    },
  ) as unknown as AgentHostControlPort;
  const run = { runId: "runtime" };
  const runtime: RuntimeAdapter = {
    busyInputSupported: options.supported ?? true,
    probe: unexpected,
    start: unexpected,
    cancel: unexpected,
    reap: unexpected,
    async notifyBusy(handle, value) {
      assert.equal(handle, run);
      sent.push(value);
      return options.notify ? await options.notify(sent.length) : true;
    },
  };
  return {
    abort,
    sent,
    get reads() {
      return reads;
    },
    get waits() {
      return waits;
    },
    async execute() {
      await maintainRuntimeBusyNotices({
        guideEnabled: () => true,
        activationId: "activation",
        runAttemptId: "attempt",
        run,
        runtime,
        control,
        signal: abort.signal,
        async wait(delay, signal) {
          assert.equal(delay, 1000);
          assert.equal(signal, abort.signal);
          if (++waits >= (options.iterations ?? 3)) abort.abort();
        },
      });
    },
  };
}

test("accepted unchanged notice is injected once across repeated polls", async () => {
  const f = fixture();
  await f.execute();
  assert.equal(f.reads, 3);
  assert.equal(f.sent.length, 1);
  assert.deepEqual(f.sent, [notice]);
});

test("explicit transport refusal retries the same notice until accepted", async () => {
  const f = fixture({ notify: async (attempt) => attempt > 1 });
  await f.execute();
  assert.equal(f.reads, 3);
  assert.deepEqual(f.sent, [notice, notice]);
});

test("a temporary Kernel read failure leaves later polling operational", async () => {
  const f = fixture({
    read: async (iteration) => {
      if (iteration === 1) throw new Error("temporary disconnection");
      return notice;
    },
  });
  await f.execute();
  assert.equal(f.reads, 3);
  assert.deepEqual(f.sent, [notice]);
});

test("abort during pending read prevents its late notice from reaching the runtime", async () => {
  const f = fixture({
    read: async (_iteration, abort) => {
      abort.abort();
      return notice;
    },
  });
  await f.execute();
  assert.equal(f.reads, 1);
  assert.equal(f.sent.length, 0);
  assert.equal(f.waits, 0);
});

test("already aborted maintenance performs no reads or runtime writes", async () => {
  const f = fixture();
  f.abort.abort();
  await f.execute();
  assert.equal(f.reads, 0);
  assert.equal(f.sent.length, 0);
  assert.equal(f.waits, 0);
});

test("a runtime without native busy support never polls Kernel", async () => {
  const f = fixture({ supported: false });
  await f.execute();
  assert.equal(f.reads, 0);
  assert.equal(f.sent.length, 0);
  assert.equal(f.waits, 0);
});

test("a changed unread fingerprint is delivered once after its predecessor", async () => {
  const changed = {
    ...notice,
    fingerprint: "b".repeat(64),
    text: "Inbox update: #other",
  };
  const f = fixture({
    read: async (iteration) => (iteration === 1 ? notice : changed),
  });
  await f.execute();
  assert.deepEqual(f.sent, [notice, changed]);
});

test("after X is written the next projection excludes X and only contributes Y", async () => {
  const abort = new AbortController();
  let reads = 0;
  const sent: string[] = [];
  const exclusions: readonly string[][] = [];
  const control = {
    async readPendingRuntimeNotice(input: {
      excludeEventIds?: readonly string[];
    }) {
      reads++;
      (exclusions as string[][]).push([...(input.excludeEventIds ?? [])]);
      const ids = (reads === 1 ? ["X"] : ["X", "Y"]).filter(
        (id) => !input.excludeEventIds?.includes(id),
      );
      return ids.length
        ? {
            eventIds: ids,
            fingerprint: ids.join("").padEnd(64, "0"),
            text: ids.join(","),
          }
        : undefined;
    },
  } as unknown as AgentHostControlPort;
  const runtime = {
    busyInputSupported: true,
    async notifyBusy(_run: unknown, value: RuntimeBusyNotice) {
      sent.push(value.text);
      return true;
    },
  } as RuntimeAdapter;
  await maintainRuntimeBusyNotices({
    guideEnabled: () => true,
    activationId: "activation",
    runAttemptId: "run",
    run: { runId: "run" },
    runtime,
    control,
    signal: abort.signal,
    async wait() {
      if (reads === 3) abort.abort();
    },
  });
  assert.deepEqual(sent, ["X", "Y"]);
  assert.deepEqual(exclusions, [[], ["X"], ["X", "Y"]]);
});

test("Wait does not inject; disabling Guide during a read prevents the pending write", async () => {
  for (const enabledAtStart of [false, true]) {
    let enabled = enabledAtStart;
    let sends = 0;
    const abort = new AbortController();
    await maintainRuntimeBusyNotices({
      activationId: "a",
      runAttemptId: "r",
      run: { runId: "r" },
      guideEnabled: () => enabled,
      runtime: {
        busyInputSupported: true,
        notifyBusy: async () => {
          sends++;
          return true;
        },
      } as unknown as RuntimeAdapter,
      control: {
        readPendingRuntimeNotice: async () => {
          enabled = false;
          return notice;
        },
      } as unknown as AgentHostControlPort,
      signal: abort.signal,
      wait: async () => {
        abort.abort();
      },
    });
    assert.equal(sends, 0);
  }
});
