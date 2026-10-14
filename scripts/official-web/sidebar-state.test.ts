import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SIDEBAR_PREFERENCES } from "@rah-os/protocol";
import {
  sidebarGroups,
  moveChannel,
  sidebarDrop,
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
  const patch = sidebarDrop(
    prefs,
    sidebarGroups(rooms, prefs, {}),
    "c",
    "b",
    false,
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
  const patch = sidebarDrop(
    prefs,
    [
      { id: "channels", rooms: [] },
      { id: "custom:work", rooms: [] },
    ],
    "group:custom:work",
    "group:channels",
    false,
  );
  assert.deepEqual(patch.sectionOrder, [
    "dms",
    "pinned",
    "custom:work",
    "channels",
  ]);
});
test("dragging a row persists its displayed position and moving sections preserves hidden entries", async () => {
  const { sidebarDrop } =
    await import("../../frontends/raft/loom/sidebar-state.ts");
  const prefs = {
    ...DEFAULT_SIDEBAR_PREFERENCES,
    customSections: [{ id: "work", name: "Work", items: [] }],
  };
  const groups = sidebarGroups(
    ["a", "b", "c"].map((roomId) => ({ roomId, name: roomId })),
    prefs,
    {},
  );
  const patch = sidebarDrop(prefs, groups, "c", "b", false);
  assert.deepEqual(
    sidebarGroups(
      ["a", "b", "c"].map((roomId) => ({ roomId, name: roomId })),
      { ...prefs, ...patch },
      {},
    )
      .find((g) => g.id === "channels")
      .rooms.map((r) => r.roomId),
    ["a", "c", "b"],
  );
  assert.deepEqual(
    sidebarDrop(prefs, groups, "c", "group:custom:work", false)
      .customSections[0].items,
    ["room:c"],
  );
});

test("dragging cannot silently replace alphabetical sorting", async () => {
  const { sidebarDrop } =
    await import("../../frontends/raft/loom/sidebar-state.ts");
  const prefs = { ...DEFAULT_SIDEBAR_PREFERENCES, channelSortMode: "az" };
  const groups = sidebarGroups(
    ["a", "b"].map((roomId) => ({ roomId, name: roomId })),
    prefs,
    {},
  );
  assert.deepEqual(sidebarDrop(prefs, groups, "b", "a", false), {});
});

test("private boxes use peer identity, independent DM sorting, durable hiding and compatible drag targets", () => {
  const boxes = [
    {
      roomId: "dm-a",
      name: "Zulu-1",
      instancePrivateBox: { instanceId: "a", active: true },
    },
    {
      roomId: "dm-b",
      name: "Alpha-1",
      instancePrivateBox: { instanceId: "b", active: false },
    },
  ];
  const rooms = [{ roomId: "channel", name: "Channel" }, ...boxes];
  const prefs = { ...DEFAULT_SIDEBAR_PREFERENCES, dmSortMode: "az" as const };
  const groups = sidebarGroups(rooms, prefs, {});
  assert.deepEqual(
    groups.find((g) => g.id === "channels")!.rooms.map((r) => r.roomId),
    ["channel"],
  );
  assert.deepEqual(
    groups.find((g) => g.id === "dms")!.rooms.map((r) => r.roomId),
    ["dm-b", "dm-a"],
  );
  const pinned = sidebarDrop(
    { ...prefs, dmSortMode: "manual" },
    groups,
    "dm-a",
    "group:pinned",
    false,
  );
  assert.deepEqual(pinned.pinned, ["peer:a"]);
  const hidden = sidebarGroups(
    rooms,
    { ...prefs, pinned: ["peer:a"], hiddenDms: ["peer:a"] },
    {},
  );
  assert.equal(
    hidden.some((g) => g.rooms.some((r) => r.roomId === "dm-a")),
    false,
  );
  assert.deepEqual(
    sidebarDrop(prefs, groups, "dm-a", "group:channels", false),
    {},
  );
  assert.deepEqual(
    sidebarDrop(prefs, groups, "channel", "group:dms", false),
    {},
  );
  const manual = { ...prefs, dmSortMode: "manual" as const };
  const moved = sidebarDrop(
    manual,
    sidebarGroups(rooms, manual, {}),
    "dm-b",
    "dm-a",
    false,
  );
  assert.deepEqual(moved.dmOrder, ["peer:b", "peer:a"]);
  assert.equal(moved.channelSortMode, undefined);
});

test("closed private conversation reappears on canonical unread without rewriting preferences", () => {
  const room = {
    roomId: "dm",
    name: "Tom",
    instancePrivateBox: { instanceId: "tom" },
  };
  const prefs = { ...DEFAULT_SIDEBAR_PREFERENCES, hiddenDms: ["peer:tom"] };
  const groups = sidebarGroups([room], prefs, {}, { dm: 2 });
  assert.equal(groups.find((g) => g.id === "dms")?.rooms[0]?.roomId, "dm");
  assert.deepEqual(prefs.hiddenDms, ["peer:tom"]);
});
