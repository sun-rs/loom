import assert from "node:assert/strict";
import { test } from "node:test";
import {
  taskFilterRequest,
  changeTaskFilter,
} from "../../frontends/raft/loom/task-filters.ts";
test("task filter request keeps combined identities and unassigned on every page", () => {
  const p = new URLSearchParams(
    "taskRoom=r&taskCreator=a&taskCreator=b&taskAssignee=c&taskAssignee=unassigned",
  );
  assert.deepEqual(taskFilterRequest(p), {
    roomIds: ["r"],
    creatorIds: ["a", "b"],
    assigneeIds: ["c"],
    unassigned: true,
  });
  assert.deepEqual(taskFilterRequest(p, "channel"), {
    roomIds: ["channel"],
    creatorIds: ["a", "b"],
    assigneeIds: ["c"],
    unassigned: true,
  });
  assert.deepEqual(taskFilterRequest(new URLSearchParams()), {});
});
test("filter routes deduplicate, preserve view and remove only their own selection", () => {
  const p = new URLSearchParams(
    "view=tasks&taskView=list&taskCreator=a&taskAssignee=b",
  );
  const next = changeTaskFilter(p, "taskCreator", ["c", "c", "d"]);
  assert.deepEqual(next.getAll("taskCreator"), ["c", "d"]);
  assert.equal(next.get("taskView"), "list");
  assert.equal(p.get("taskCreator"), "a");
  assert.equal(
    changeTaskFilter(next, "taskCreator", []).has("taskCreator"),
    false,
  );
  assert.equal(next.get("taskAssignee"), "b");
});
