import assert from "node:assert/strict";
import test from "node:test";

import {
  clampComputerSidebarWidth,
  nextComputerSidebarWidth,
  readComputerSidebarWidth,
  RAFT_COMPUTER_SIDEBAR_DEFAULT_WIDTH,
  RAFT_COMPUTER_SIDEBAR_MAX_WIDTH,
  RAFT_COMPUTER_SIDEBAR_MIN_WIDTH,
  writeComputerSidebarWidth,
} from "../src/computer-sidebar-resize.ts";

test("Computer owns Raft's 240 / 180..320 sidebar contract", () => {
  assert.equal(RAFT_COMPUTER_SIDEBAR_DEFAULT_WIDTH, 240);
  assert.equal(RAFT_COMPUTER_SIDEBAR_MIN_WIDTH, 180);
  assert.equal(RAFT_COMPUTER_SIDEBAR_MAX_WIDTH, 320);
  assert.equal(clampComputerSidebarWidth(80), 180);
  assert.equal(clampComputerSidebarWidth(840), 320);
  assert.equal(clampComputerSidebarWidth(233.6), 234);
});

test("Computer width persists separately from the Room sidebar", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  assert.equal(readComputerSidebarWidth(storage), 240);
  writeComputerSidebarWidth(storage, 280);
  assert.equal(values.get("rah:computer-sidebar-width"), "280");
  assert.equal(values.has("rah:room-sidebar-width"), false);
  assert.equal(readComputerSidebarWidth(storage), 280);
  values.set("rah:computer-sidebar-width", "9000");
  assert.equal(readComputerSidebarWidth(storage), 240);
});

test("Computer keyboard resizing follows its right-edge handle", () => {
  assert.equal(nextComputerSidebarWidth(320, "ArrowLeft"), 312);
  assert.equal(nextComputerSidebarWidth(320, "ArrowRight"), 320);
  assert.equal(nextComputerSidebarWidth(320, "Home"), 180);
  assert.equal(nextComputerSidebarWidth(320, "End"), 320);
  assert.equal(nextComputerSidebarWidth(320, "Escape"), undefined);
});
