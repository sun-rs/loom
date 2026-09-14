import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SIDEBAR_PREFERENCES } from "@rah-os/protocol";
import { sidebarDrop, sortSidebar } from "../src/sidebar-order.ts";
test("Raft manual/recent/A-Z sorting preserves identities and moves a pin only once", () => {
  const rows = [
    { key: "room:b", label: "Beta" },
    { key: "room:a", label: "Alpha" },
  ];
  assert.deepEqual(
    sortSidebar(rows, "az", [], {}).map((x) => x.key),
    ["room:a", "room:b"],
  );
  assert.deepEqual(
    sortSidebar(rows, "recent", [], { "room:a": "2026-09-01" }).map(
      (x) => x.key,
    ),
    ["room:a", "room:b"],
  );
  const pinned = sidebarDrop(
    DEFAULT_SIDEBAR_PREFERENCES,
    "room:a",
    "pinned",
    undefined,
    ["room:a", "room:b"],
  );
  assert.deepEqual(pinned?.pinned, ["room:a"]);
  assert.deepEqual(
    sidebarDrop(
      { ...DEFAULT_SIDEBAR_PREFERENCES, pinned: ["room:a"] },
      "room:a",
      "pinned",
      undefined,
      [],
    )?.pinned,
    ["room:a"],
  );
  assert.equal(
    sidebarDrop(
      { ...DEFAULT_SIDEBAR_PREFERENCES, channelSortMode: "az" },
      "room:a",
      "channels",
      "room:b",
      rows.map((x) => x.key),
    ),
    undefined,
  );
});
test("manual reordering uses the target slot and self-drops are no-ops", () => {
  const p = {
    ...DEFAULT_SIDEBAR_PREFERENCES,
    channelOrder: ["room:a", "room:b", "room:c"],
  };
  assert.equal(
    sidebarDrop(p, "room:a", "channels", "room:a", p.channelOrder),
    undefined,
  );
  assert.deepEqual(
    sidebarDrop(p, "room:a", "channels", "room:c", p.channelOrder)
      ?.channelOrder,
    ["room:b", "room:c", "room:a"],
  );
});

test("custom section moves preserve one placement and system type fences", () => {
  const p = {
    ...DEFAULT_SIDEBAR_PREFERENCES,
    pinned: ["room:a"],
    customSections: [
      { id: "one", name: "One", items: [] },
      { id: "two", name: "Two", items: ["peer:b"] },
    ],
  };
  const patch = sidebarDrop(p, "room:a", "custom:one", undefined, []);
  assert.deepEqual(patch?.pinned, []);
  assert.deepEqual(patch?.customSections?.[0]?.items, ["room:a"]);
  const moved = sidebarDrop(p, "peer:b", "custom:one", undefined, []);
  assert.deepEqual(
    moved?.customSections?.map((s) => s.items),
    [["peer:b"], []],
  );
  assert.equal(sidebarDrop(p, "peer:b", "channels", undefined, []), undefined);
  assert.equal(sidebarDrop(p, "room:a", "dms", undefined, []), undefined);
  assert.deepEqual(
    sidebarDrop(p, "peer:b", "dms", undefined, [])?.customSections?.[1]?.items,
    [],
  );
  assert.equal(
    sidebarDrop(p, "room:a", "custom:missing", undefined, []),
    undefined,
  );
});
