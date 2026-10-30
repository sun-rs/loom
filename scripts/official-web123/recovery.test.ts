import test from "node:test";
import assert from "node:assert/strict";
import { installReadRecovery } from "../../frontends/raft/adapter123/read-recovery.ts";
test("read recovery coalesces visibility/focus hints and never refreshes hidden or disposed views", async () => {
  let tick = () => {},
    visible = true,
    release = () => {},
    calls = 0,
    removed = false;
  const port = {
    visible: () => visible,
    every: (fn: () => void) => {
      tick = fn;
      return () => {
        removed = true;
      };
    },
    listen: (_name: string, fn: () => void) => {
      tick = fn;
      return () => {};
    },
  };
  const stop = installReadRecovery(async () => {
    calls++;
    await new Promise<void>((r) => {
      release = r;
    });
  }, port);
  tick();
  tick();
  assert.equal(calls, 1);
  release();
  await new Promise((r) => setTimeout(r, 0));
  visible = false;
  tick();
  assert.equal(calls, 1);
  visible = true;
  tick();
  assert.equal(calls, 2);
  stop();
  release();
  await new Promise((r) => setTimeout(r, 0));
  tick();
  assert.equal(calls, 2);
  assert.equal(removed, true);
});
