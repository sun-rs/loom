import assert from "node:assert/strict";
import test from "node:test";

import { taskMatchesFilters } from "../src/task-presentation.ts";

const assigned = { assigneeId: "agent-alice", creatorId: "human-owner" };
const unassigned = { creatorId: "agent-cindy" };

test("Task filters compose Raft creator and assignee selections", () => {
  assert.equal(taskMatchesFilters(assigned, {}), true);
  assert.equal(
    taskMatchesFilters(assigned, { creatorId: "human-owner" }),
    true,
  );
  assert.equal(
    taskMatchesFilters(assigned, { creatorId: "agent-cindy" }),
    false,
  );
  assert.equal(
    taskMatchesFilters(assigned, { assigneeId: "agent-alice" }),
    true,
  );
  assert.equal(
    taskMatchesFilters(assigned, { assigneeId: "agent-cindy" }),
    false,
  );
  assert.equal(taskMatchesFilters(unassigned, { assigneeId: null }), true);
  assert.equal(taskMatchesFilters(assigned, { assigneeId: null }), false);
  assert.equal(
    taskMatchesFilters(assigned, {
      assigneeId: "agent-alice",
      creatorId: "human-owner",
    }),
    true,
  );
});
