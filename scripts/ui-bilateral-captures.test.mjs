import assert from "node:assert/strict";
import test from "node:test";
import { comparisonConditions } from "./ui-bilateral-captures.mjs";

const capture = () => ({
  environment: { width: 1440, height: 900, dpr: 2, zoom: 1 },
  state: "profile-rest",
  dataShape: { agents: 4 },
});
test("paired screenshots never imply acceptance, even with equal preconditions", () => {
  assert.deepEqual(comparisonConditions(capture(), capture()), {
    status: "human-review-required",
    differences: [],
  });
});
test("DPR, viewport, zoom, state and data differences remain explicit", () => {
  const local = capture();
  local.environment.dpr = 1;
  local.dataShape.agents = 5;
  assert.deepEqual(comparisonConditions(capture(), local), {
    status: "preconditions-differ",
    differences: ["environment.dpr", "dataShape"],
  });
  delete local.environment.zoom;
  assert.ok(
    comparisonConditions(capture(), local).differences.includes(
      "environment.zoom",
    ),
  );
});
test("data shape equality ignores property order but never missing evidence", () => {
  const official = capture(),
    local = capture();
  official.dataShape = { rooms: 1, messages: 2 };
  local.dataShape = { messages: 2, rooms: 1 };
  assert.equal(
    comparisonConditions(official, local).status,
    "human-review-required",
  );
  delete local.state;
  assert.equal(
    comparisonConditions(official, local).status,
    "preconditions-differ",
  );
});
