import assert from "node:assert/strict";
export function comparePixels(a, b) {
  assert.equal(a.data.length, b.data.length, "image dimensions differ");
  assert.equal(a.info.width, b.info.width);
  assert.equal(a.info.height, b.info.height);
  let differingPixels = 0,
    maxDelta = 0;
  const diff = Buffer.alloc(a.data.length, 255);
  for (let i = 0; i < a.data.length; i += 4) {
    let delta = 0;
    for (let c = 0; c < 4; c++)
      delta = Math.max(delta, Math.abs(a.data[i + c] - b.data[i + c]));
    maxDelta = Math.max(maxDelta, delta);
    if (delta) {
      differingPixels++;
      diff[i] = 255;
      diff[i + 1] = 0;
      diff[i + 2] = 80;
    }
  }
  return {
    differingPixels,
    totalPixels: a.info.width * a.info.height,
    maxDelta,
    ratio: differingPixels / (a.info.width * a.info.height),
    diff,
  };
}
