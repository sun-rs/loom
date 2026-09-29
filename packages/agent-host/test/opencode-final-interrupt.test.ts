import assert from "node:assert/strict";
import test from "node:test";

import { createOpenCodeFinalInterrupt } from "../src/opencode-final-interrupt.js";

/**
 * Seventh review P1-2: the persisted-tool check before an OpenCode final
 * abort fails closed. When the listing cannot be read (or is not a trusted
 * list) and the stream has not shown the posting tool, the abort optimization
 * is dropped for this run and the turn ends naturally; it never treats an
 * unreadable listing as "no tool in flight".
 */
const settleMicrotasks = async () => {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
};

test("a failing persisted-tool listing (checked at most twice) never aborts while the posting tool may run", async () => {
  let interrupts = 0;
  let listings = 0;
  const helper = createOpenCodeFinalInterrupt({
    interrupt: () => {
      interrupts += 1;
      return true;
    },
    inFlightTools: async () => {
      listings += 1;
      throw new Error("GET /session/:id/message failed");
    },
  });
  assert.equal(helper.arm(), true);
  await settleMicrotasks();
  assert.equal(interrupts, 0, "no abort without a trusted tool listing");
  assert.equal(listings, 2, "one bounded recheck, no unbounded retry");
  assert.equal(helper.issued, false);
  // A later stream event does not restart the abandoned optimization.
  helper.observePart({ type: "text", id: "text-1" });
  await settleMicrotasks();
  assert.equal(listings, 2);
  assert.equal(interrupts, 0);
  helper.settle(false);
  assert.equal(helper.report().requested, false);
});

test("an untrusted listing shape is treated like a failed listing", async () => {
  let interrupts = 0;
  const helper = createOpenCodeFinalInterrupt({
    interrupt: () => {
      interrupts += 1;
      return true;
    },
    inFlightTools: async () => "not a list" as unknown as unknown[],
  });
  helper.arm();
  await settleMicrotasks();
  assert.equal(interrupts, 0);
});

test("a recheck that succeeds with no tool in flight still aborts", async () => {
  let interrupts = 0;
  let listings = 0;
  const helper = createOpenCodeFinalInterrupt({
    interrupt: () => {
      interrupts += 1;
      return true;
    },
    inFlightTools: async () => {
      listings += 1;
      if (listings === 1) throw new Error("transient");
      return [];
    },
  });
  helper.arm();
  await settleMicrotasks();
  assert.equal(listings, 2);
  assert.equal(interrupts, 1);
});

test("a listing showing the posting tool running waits for its terminal state", async () => {
  let interrupts = 0;
  const running = {
    id: "tool-1",
    type: "tool",
    state: {
      status: "running",
      input: {
        command:
          '"$RAH_WORKER_CLI" worker message-post --target "#main" --final',
      },
    },
  };
  const helper = createOpenCodeFinalInterrupt({
    interrupt: () => {
      interrupts += 1;
      return true;
    },
    inFlightTools: async () => (interrupts === 0 ? [running] : []),
  });
  helper.arm();
  await settleMicrotasks();
  assert.equal(interrupts, 0);
  helper.observePart({
    ...running,
    state: { ...running.state, status: "completed" },
  });
  await settleMicrotasks();
  assert.equal(interrupts, 1);
});
