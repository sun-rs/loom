import assert from "node:assert/strict";
import test from "node:test";

import {
  floatingContextMenuPosition,
  nextContextMenuItemIndex,
} from "../src/floating-context-menu-model.ts";

test("Raft floating menus clamp their measured box on every viewport edge", () => {
  assert.deepEqual(
    floatingContextMenuPosition({
      anchorX: 380,
      anchorY: 830,
      menuWidth: 224,
      menuHeight: 288,
      viewportWidth: 390,
      viewportHeight: 844,
    }),
    { x: 158, y: 548 },
  );
  assert.deepEqual(
    floatingContextMenuPosition({
      anchorX: -20,
      anchorY: -30,
      menuWidth: 224,
      menuHeight: 288,
      viewportWidth: 390,
      viewportHeight: 844,
    }),
    { x: 8, y: 8 },
  );
});

test("context menu keyboard navigation wraps only through enabled items", () => {
  const enabled = [0, 2, 4];
  assert.equal(nextContextMenuItemIndex(enabled, 0, "next"), 2);
  assert.equal(nextContextMenuItemIndex(enabled, 4, "next"), 0);
  assert.equal(nextContextMenuItemIndex(enabled, 0, "previous"), 4);
  assert.equal(nextContextMenuItemIndex(enabled, 2, "first"), 0);
  assert.equal(nextContextMenuItemIndex(enabled, 2, "last"), 4);
  assert.equal(nextContextMenuItemIndex([], 0, "next"), undefined);
});
