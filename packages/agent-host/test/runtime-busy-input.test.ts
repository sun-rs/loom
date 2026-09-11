import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeBusyInput } from "../src/runtime-busy-input.ts";

test("a stalled stdin write cannot outlive the busy delivery deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const input = new RuntimeBusyInput();
  const pending = input.send(
    { fingerprint: "a".repeat(64), text: "append" },
    () => new Promise(() => {}),
  );
  let result: boolean | undefined;
  void pending.then((value) => {
    result = value;
  });
  t.mock.timers.tick(1501);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(result, false);
});
