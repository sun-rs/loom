import assert from "node:assert/strict";
import test from "node:test";
import { waitForKimiEofExit } from "../src/kimi-eof-drain.mjs";

for (const code of [0, 7]) {
  test(`EOF drain waits beyond the former five-second deadline and preserves actual exit ${code}`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let finish;
    const exit = new Promise((resolve) => {
      finish = resolve;
    });
    let settled = false;
    const result = waitForKimiEofExit(exit).finally(() => {
      settled = true;
    });
    t.mock.timers.tick(8000);
    await Promise.resolve();
    assert.equal(settled, false);
    finish({ code, signal: null });
    assert.deepEqual(await result, { code, signal: null });
    t.mock.timers.tick(6000);
  });
}
test("EOF drain has a fifteen second bound and cannot turn later zero exit into success", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let finish;
  const result = waitForKimiEofExit(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const rejected = assert.rejects(
    result,
    /Kimi did not exit within 15000ms after EOF/,
  );
  t.mock.timers.tick(15000);
  await rejected;
  finish({ code: 0, signal: null });
  await assert.rejects(result);
});
