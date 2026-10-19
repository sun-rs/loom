import test from "node:test";
import assert from "node:assert/strict";
import { activityPinnedRows } from "../../frontends/raft/loom/activity-pinned.ts";
test("official pin sections stably partition loaded conversations, never their threads", () => {
  const rows = [
    { id: "new", message: { roomId: "a" }, activityKind: "channel" },
    { id: "thread", message: { roomId: "b" }, activityKind: "thread" },
    { id: "old", message: { roomId: "b" }, activityKind: "channel" },
    { id: "dm", message: { roomId: "c" }, activityKind: "direct" },
  ] as any;
  const result = activityPinnedRows(rows, [
    "room:c",
    "room:b",
    "room:unloaded",
  ]);
  assert.deepEqual(
    result.map((r) => [r.row.id, r.section]),
    [
      ["old", "pinned"],
      ["dm", undefined],
      ["new", "all"],
      ["thread", undefined],
    ],
  );
  assert.deepEqual(
    rows.map((r: any) => r.id),
    ["new", "thread", "old", "dm"],
  );
  assert.ok(activityPinnedRows(rows, []).every((r) => r.section === undefined));
  assert.ok(
    activityPinnedRows(rows, ["peer:b"]).every((r) => r.section === undefined),
  );
});
