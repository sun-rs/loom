import assert from "node:assert/strict";
import test from "node:test";
import {
  nextPdfScale,
  parsePdfPageNumber,
  pdfRasterSize,
} from "../src/pdf-reading.ts";
test("PDF zoom follows Mozilla 1.1 rounding and limits", () => {
  assert.equal(nextPdfScale(1, 1), 1.1);
  assert.equal(nextPdfScale(1.1, 1), 1.3);
  assert.equal(nextPdfScale(1, -1), 0.9);
  assert.equal(nextPdfScale(25, 1), 25);
  assert.equal(nextPdfScale(0.1, -1), 0.1);
});
test("page jumps refuse fractional, out of range, exponential and empty input", () => {
  for (const value of ["", "0", "3", "1.1", "1e0", "-1"])
    assert.equal(parsePdfPageNumber(value, 2), undefined);
  assert.equal(parsePdfPageNumber(" 2 ", 2), 2);
});
test("high zoom and pathological page aspect never exceed the existing raster budget", () => {
  for (const [width, height] of [
    [600, 800],
    [1, 100000],
    [100000, 1],
    [333, 777],
  ]) {
    const size = pdfRasterSize(width!, height!, 25);
    assert.ok(size.width >= 1 && size.height >= 1);
    assert.ok(size.width * size.height <= 4_000_000);
  }
  assert.ok(
    pdfRasterSize(600, 800, 2).width > pdfRasterSize(600, 800, 1).width,
  );
});
