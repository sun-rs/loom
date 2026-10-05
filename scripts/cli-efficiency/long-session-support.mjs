import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const longHash = (value) =>
  createHash("sha256").update(value).digest("hex");

export function verifyLongSnapshot(snapshot, expectedHashes) {
  assert.deepEqual(
    Object.keys(snapshot).sort(),
    Object.keys(expectedHashes).sort(),
    "Source inventory changed",
  );
  for (const [path, body] of Object.entries(snapshot))
    assert.equal(
      longHash(body),
      expectedHashes[path],
      `Source changed: ${path}`,
    );
}

// Admission bound, checked before starting another stage. An in-flight stage
// retains the existing provider timeout; this is not an exact billing cap.
export function checkLongSessionBudget(
  arm,
  { startedAt, now = Date.now(), maxMs, maxInput },
) {
  let observed = 0;
  for (const r of arm.rounds) {
    assert.ok(
      Number.isFinite(r.metrics?.input) && r.metrics.input >= 0,
      "Missing observed input: stop rather than assume zero",
    );
    observed += r.metrics.input;
  }
  assert.ok(
    observed < maxInput && now - startedAt < maxMs,
    "RESOURCE_LIMIT: no more stages admitted",
  );
}
