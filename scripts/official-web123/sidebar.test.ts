import test from "node:test";
import assert from "node:assert/strict";
import {
  nativeSidebar,
  sidebarPatch,
} from "../../frontends/raft/adapter123/sidebar.ts";
const prefs: any = {
  version: 7,
  pinned: ["room:alpha"],
  channelOrder: ["room:alpha", "room:beta"],
  dmOrder: [],
  hiddenDms: [],
  customSections: [{ id: "work", name: "Work", items: ["room:beta"] }],
  sectionOrder: ["pinned", "channels", "custom:work", "dms"],
  channelPanelTabOrder: [],
  channelSortMode: "manual",
  dmSortMode: "manual",
  pinnedSortMode: "manual",
};
test("native sidebar uses kind refs and lossless section/order projections, retaining exact SDK revision", () => {
  const view = nativeSidebar(prefs);
  assert.deepEqual(view.pinned, [{ kind: "channel", id: "alpha" }]);
  assert.equal(view.sectionsVersion, 7);
  assert.equal(view.pinnedVersion, 7);
  assert.deepEqual(view.sectionPlacements, [
    { kind: "channel", id: "beta", sectionId: "work", position: 0 },
  ]);
  const patch = sidebarPatch(
    {
      pinned: [{ kind: "channel", id: "beta" }],
      sectionPlacements: [
        { kind: "channel", id: "alpha", sectionId: "work", position: 0 },
      ],
      channelOrder: ["beta", "alpha"],
    },
    prefs,
  );
  assert.deepEqual(patch.pinned, ["room:beta"]);
  assert.deepEqual(patch.customSections?.[0]?.items, ["room:alpha"]);
  assert.deepEqual(patch.channelOrder, ["room:beta", "room:alpha"]);
  assert.equal(
    Object.hasOwn(patch, "dmOrder"),
    false,
    "a channel drag must not reset unrelated settings",
  );
});
test("native custom-section sort and section order preserve their source semantics", () => {
  const patch = sidebarPatch(
    {
      sectionOrder: [
        "work",
        "system:channels",
        "system:joint",
        "system:pinned",
        "system:dms",
      ],
      customSections: [
        { id: "work", name: "Renamed", emoji: null, sortMode: "az" },
      ],
    },
    prefs,
  );
  assert.deepEqual(patch.sectionOrder, [
    "custom:work",
    "channels",
    "joint",
    "pinned",
    "dms",
  ]);
  assert.deepEqual(patch.customSections?.[0], {
    id: "work",
    name: "Renamed",
    emoji: null,
    items: ["room:beta"],
    sortMode: "az",
  });
  assert.throws(
    () => sidebarPatch({ pinned: [{ kind: "agent", id: "role-id" }] }, prefs),
    /单聊|实例|对话/,
  );
});
test("only verified standalone instance peers map to DM Rooms; native file tabs retain SDK workspace identity", () => {
  const peers = new Map([["instance", "standalone"]]);
  const p = {
    ...prefs,
    dmOrder: ["room:standalone"],
    pinned: ["room:standalone"],
    channelPanelTabOrder: ["workspace", "chat", "tasks"],
  };
  const view = nativeSidebar(p, peers);
  assert.deepEqual(view.pinned, [{ kind: "agent", id: "instance" }]);
  assert.deepEqual(view.dmOrder, ["standalone"]);
  assert.deepEqual(view.channelPanelTabOrder, ["files", "chat", "tasks"]);
  const patch = sidebarPatch(
    { pinned: view.pinned, channelPanelTabOrder: view.channelPanelTabOrder },
    p,
    peers,
  );
  assert.deepEqual(patch.pinned, p.pinned);
  assert.deepEqual(patch.channelPanelTabOrder, p.channelPanelTabOrder);
  assert.throws(
    () =>
      sidebarPatch(
        {
          sectionPlacements: [
            { kind: "channel", id: "alpha", sectionId: "missing", position: 0 },
          ],
        },
        prefs,
      ),
    /未知侧栏分区/,
  );
  assert.throws(
    () => sidebarPatch({ agentOrder: ["role-id"] }, prefs),
    /尚未对接/,
  );
  assert.throws(
    () => nativeSidebar({ ...prefs, pinned: ["peer:unknown-principal"] }),
    /旧私信身份/,
  );
});
