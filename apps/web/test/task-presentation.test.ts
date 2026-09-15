import assert from "node:assert/strict";
import test from "node:test";
import { taskMatchesFilters } from "../src/task-presentation.ts";
const assigned = { assigneeId: "agent-alice", creatorId: "human-owner" };
const unassigned = { creatorId: "agent-cindy" };
test("Task filters use OR within each multiple selection and AND across fields", () => {
  assert.equal(taskMatchesFilters(assigned, {}), true);
  assert.equal(
    taskMatchesFilters(assigned, {
      creatorIds: ["agent-cindy", "human-owner"],
    }),
    true,
  );
  assert.equal(
    taskMatchesFilters(assigned, { creatorIds: ["agent-cindy"] }),
    false,
  );
  assert.equal(
    taskMatchesFilters(assigned, {
      assigneeIds: ["agent-cindy", "agent-alice"],
    }),
    true,
  );
  assert.equal(
    taskMatchesFilters(assigned, { assigneeIds: ["agent-cindy"] }),
    false,
  );
  assert.equal(
    taskMatchesFilters(unassigned, {
      assigneeIds: ["unassigned", "agent-alice"],
    }),
    true,
  );
  assert.equal(
    taskMatchesFilters(assigned, { assigneeIds: ["unassigned"] }),
    false,
  );
  assert.equal(
    taskMatchesFilters(assigned, {
      creatorIds: ["agent-cindy"],
      assigneeIds: ["agent-alice"],
    }),
    false,
  );
  assert.equal(
    taskMatchesFilters(assigned, { creatorIds: [], assigneeIds: [] }),
    true,
  );
});
