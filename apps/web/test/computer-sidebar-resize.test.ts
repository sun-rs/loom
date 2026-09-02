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

test("Computer owns Raft's 320 / 240..520 sidebar contract", () => {
  assert.equal(RAFT_COMPUTER_SIDEBAR_DEFAULT_WIDTH, 320);
  assert.equal(RAFT_COMPUTER_SIDEBAR_MIN_WIDTH, 240);
  assert.equal(RAFT_COMPUTER_SIDEBAR_MAX_WIDTH, 520);
  assert.equal(clampComputerSidebarWidth(80), 240);
  assert.equal(clampComputerSidebarWidth(840), 520);
  assert.equal(clampComputerSidebarWidth(333.6), 334);
});

test("Computer width persists separately from the Room sidebar", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  assert.equal(readComputerSidebarWidth(storage), 320);
  writeComputerSidebarWidth(storage, 408);
  assert.equal(values.get("rah:computer-sidebar-width"), "408");
  assert.equal(values.has("rah:room-sidebar-width"), false);
  assert.equal(readComputerSidebarWidth(storage), 408);
  values.set("rah:computer-sidebar-width", "9000");
  assert.equal(readComputerSidebarWidth(storage), 320);
});

test("Computer keyboard resizing follows its right-edge handle", () => {
  assert.equal(nextComputerSidebarWidth(320, "ArrowLeft"), 312);
  assert.equal(nextComputerSidebarWidth(320, "ArrowRight"), 328);
  assert.equal(nextComputerSidebarWidth(320, "Home"), 240);
  assert.equal(nextComputerSidebarWidth(320, "End"), 520);
  assert.equal(nextComputerSidebarWidth(320, "Escape"), undefined);
});
