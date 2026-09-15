import assert from "node:assert/strict";
import { test } from "node:test";
import {
  restoreTaskFilters,
  rememberTaskFilters,
} from "../src/task-filter-session.ts";
test("task filters survive navigation per workspace without reviving a target", () => {
  const memory = new Map<string, string>();
  rememberTaskFilters(
    memory,
    "a",
    new URLSearchParams(
      "creator=c&creator=d&assignee=unassigned&channel=r&task=old",
    ),
  );
  const next = restoreTaskFilters(
    memory,
    "a",
    new URLSearchParams("surface=tasks&room=new"),
    false,
  );
  assert.deepEqual(next.getAll("creator"), ["c", "d"]);
  assert.equal(next.get("room"), "new");
  assert.equal(next.has("task"), false);
  assert.equal(
    restoreTaskFilters(
      memory,
      "b",
      new URLSearchParams("surface=tasks"),
      false,
    ).has("creator"),
    false,
  );
});
test("refresh clears filters but preserves deep-linked task; explicit first navigation retains filters", () => {
  const params = new URLSearchParams(
    "surface=tasks&creator=c&assignee=a&channel=r&task=t",
  );
  const next = restoreTaskFilters(new Map(), "a", params, true);
  assert.equal(next.has("creator"), false);
  assert.equal(next.has("assignee"), false);
  assert.equal(next.has("channel"), false);
  assert.equal(next.get("task"), "t");
  assert.equal(
    restoreTaskFilters(new Map(), "a", params, false).get("creator"),
    "c",
  );
});
