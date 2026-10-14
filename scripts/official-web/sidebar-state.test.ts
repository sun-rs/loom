import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SIDEBAR_PREFERENCES } from "@rah-os/protocol";
import {
  sidebarGroups,
  moveChannel,
  reorderChannel,
  reorderSection,
} from "../../frontends/raft/loom/sidebar-state.ts";
test("sidebar placement is canonical, pinning does not erase group and unknown rooms never render", () => {
  const rooms = [
    { roomId: "a", name: "Zulu" },
    { roomId: "b", name: "Alpha" },
  ];
  const preferences = {
    ...DEFAULT_SIDEBAR_PREFERENCES,
    pinned: ["room:a"],
    customSections: [
      { id: "work", name: "Work", items: ["room:a", "room:gone"] },
    ],
  };
  const groups = sidebarGroups(rooms, preferences, {});
  assert.deepEqual(
    groups.map((g) => [g.id, g.rooms.map((r) => r.roomId)]),
    [
      ["pinned", ["a"]],
      ["channels", ["b"]],
      ["custom:work", []],
    ],
  );
  assert.deepEqual(
    moveChannel(preferences, "b", "custom:work").customSections[0].items,
    ["room:a", "room:gone", "room:b"],
  );
  assert.deepEqual(preferences.customSections[0].items, [
    "room:a",
    "room:gone",
  ]);
});
test("alphabetical and recent modes use actual names and server timestamps", () => {
  const rooms = [
    { roomId: "a", name: "Zulu" },
    { roomId: "b", name: "Alpha" },
  ];
  assert.deepEqual(
    sidebarGroups(
      rooms,
      { ...DEFAULT_SIDEBAR_PREFERENCES, channelSortMode: "az" },
      {},
    )
      .find((g) => g.id === "channels")
      .rooms.map((r) => r.roomId),
    ["b", "a"],
  );
  assert.deepEqual(
    sidebarGroups(
      rooms,
      { ...DEFAULT_SIDEBAR_PREFERENCES, channelSortMode: "recent" },
      { "room:a": "2026-10-14", "room:b": "2026-10-13" },
    )
      .find((g) => g.id === "channels")
      .rooms.map((r) => r.roomId),
    ["a", "b"],
  );
});
test("moving a row changes one adjacent position even when saved manual order is empty", () => {
  const rooms = ["a", "b", "c", "d"].map((roomId) => ({
    roomId,
    name: roomId,
  }));
  const prefs = { ...DEFAULT_SIDEBAR_PREFERENCES };
  const patch = reorderChannel(
    prefs,
    "channels",
    rooms.map((r) => r.roomId),
    "c",
    -1,
  );
  assert.deepEqual(
    sidebarGroups(rooms, { ...prefs, ...patch }, {})
      .find((g) => g.id === "channels")
      .rooms.map((r) => r.roomId),
    ["a", "c", "b", "d"],
  );
  assert.deepEqual(prefs.channelOrder, []);
});
test("section reordering preserves unrelated DM placement and ignores hidden empty pinned section", () => {
  const prefs = {
    ...DEFAULT_SIDEBAR_PREFERENCES,
    sectionOrder: ["dms", "pinned", "channels", "custom:work"],
  };
  const patch = reorderSection(
    prefs,
    ["channels", "custom:work"],
    "custom:work",
    -1,
  );
  assert.deepEqual(patch.sectionOrder, [
    "dms",
    "pinned",
    "custom:work",
    "channels",
  ]);
});
