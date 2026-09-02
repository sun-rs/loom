import assert from "node:assert/strict";
import test from "node:test";

import {
  computerProfileEditorAction,
  normalizeComputerDescription,
  normalizeComputerName,
} from "../src/computer-profile-edit.ts";

test("Computer name follows Raft Enter/Escape semantics", () => {
  assert.equal(
    computerProfileEditorAction("name", "Enter", false, false, false),
    "save",
  );
  assert.equal(
    computerProfileEditorAction("name", "Escape", false, false, false),
    "cancel",
  );
  assert.equal(
    computerProfileEditorAction("name", "Enter", false, false, true),
    undefined,
  );
  assert.equal(normalizeComputerName("  Mac\nStudio  "), "Mac Studio");
});

test("Computer description saves only on modifier Enter and normalizes empty to null", () => {
  assert.equal(
    computerProfileEditorAction("description", "Enter", true, false, false),
    "save",
  );
  assert.equal(
    computerProfileEditorAction("description", "Enter", false, true, false),
    "save",
  );
  assert.equal(
    computerProfileEditorAction("description", "Enter", false, false, false),
    undefined,
  );
  assert.equal(
    computerProfileEditorAction("description", "Escape", false, false, false),
    "cancel",
  );
  assert.equal(
    normalizeComputerDescription("  local machine  "),
    "local machine",
  );
  assert.equal(normalizeComputerDescription("  \n "), null);
});
