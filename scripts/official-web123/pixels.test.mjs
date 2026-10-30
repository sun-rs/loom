import test from "node:test";
import assert from "node:assert/strict";
import { comparePixels } from "./pixels.mjs";
test("unmasked pixel gate detects a single color or alpha pixel difference", () => {
  const original = {
    info: { width: 2, height: 1 },
    data: Buffer.from([255, 255, 255, 255, 0, 0, 0, 255]),
  };
  assert.equal(comparePixels(original, original).differingPixels, 0);
  const changed = { ...original, data: Buffer.from(original.data) };
  changed.data[7] = 254;
  assert.equal(comparePixels(original, changed).differingPixels, 1);
  assert.throws(
    () =>
      comparePixels(original, { ...original, info: { width: 1, height: 2 } }),
    /equal/,
  );
});
