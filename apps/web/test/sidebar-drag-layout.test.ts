import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SIDEBAR_PREFERENCES } from "@rah-os/protocol";
import {
  moveSidebarPreview,
  sidebarPreviewPatch,
} from "../src/sidebar-drag-layout.ts";
test("drag preview moves one identity at the pointer insertion slot and keeps unchanged layouts stable", () => {
  const original = {
    channels: ["room:a", "room:b"],
    dms: ["peer:c"],
    "custom:work": ["room:d", "peer:e"],
  };
  const next = moveSidebarPreview(
    original,
    "room:a",
    "custom:work",
    "peer:e",
    false,
  );
  assert.deepEqual(next, {
    channels: ["room:b"],
    dms: ["peer:c"],
    "custom:work": ["room:d", "room:a", "peer:e"],
  });
  assert.deepEqual(original.channels, ["room:a", "room:b"]);
  assert.equal(
    moveSidebarPreview(next, "room:a", "custom:work", "peer:e", false),
    next,
  );
  assert.deepEqual(
    moveSidebarPreview(next, "room:a", "custom:work", "peer:e", true)[
      "custom:work"
    ],
    ["room:d", "peer:e", "room:a"],
  );
  assert.equal(
    moveSidebarPreview(original, "peer:c", "channels", undefined, false),
    original,
  );
  assert.equal(
    moveSidebarPreview(original, "room:a", "dms", undefined, false),
    original,
  );
});

test("committing a visible drag preserves hidden conversation placement", () => {
  const p = {
    ...DEFAULT_SIDEBAR_PREFERENCES,
    hiddenDms: ["peer:hidden"],
    customSections: [
      { id: "work", name: "Work", items: ["peer:hidden", "room:a"] },
    ],
  };
  const patch = sidebarPreviewPatch(
    p,
    {
      version: 0,
      sections: ["channels", "dms", "pinned", "custom:work"],
      items: { channels: ["room:a"], dms: [], pinned: [], "custom:work": [] },
    },
    new Set(["room:a"]),
  );
  assert.deepEqual(patch.customSections[0]?.items, ["peer:hidden"]);
  assert.deepEqual(patch.channelOrder, ["room:a"]);
});
