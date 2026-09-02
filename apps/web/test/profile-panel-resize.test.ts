import assert from "node:assert/strict";
import test from "node:test";

import {
  clampProfilePanelWidth,
  nextProfilePanelWidth,
  RAFT_PROFILE_PANEL_DEFAULT_WIDTH,
  RAFT_PROFILE_PANEL_MAX_WIDTH,
  RAFT_PROFILE_PANEL_MIN_WIDTH,
  readProfilePanelWidth,
  writeProfilePanelWidth,
} from "../src/profile-panel-resize.ts";

test("Agent profile panel follows the Raft desktop width contract", () => {
  assert.equal(RAFT_PROFILE_PANEL_DEFAULT_WIDTH, 380);
  assert.equal(RAFT_PROFILE_PANEL_MIN_WIDTH, 300);
  assert.equal(RAFT_PROFILE_PANEL_MAX_WIDTH, 600);
  assert.equal(clampProfilePanelWidth(120), 300);
  assert.equal(clampProfilePanelWidth(720), 600);
  assert.equal(clampProfilePanelWidth(412.4), 412);
});

test("left-edge profile separator uses the Raft drag direction", () => {
  assert.equal(nextProfilePanelWidth(380, "ArrowLeft"), 388);
  assert.equal(nextProfilePanelWidth(380, "ArrowRight"), 372);
  assert.equal(nextProfilePanelWidth(380, "Home"), 300);
  assert.equal(nextProfilePanelWidth(380, "End"), 600);
  assert.equal(nextProfilePanelWidth(380, "Enter"), undefined);
  assert.equal(nextProfilePanelWidth(600, "ArrowLeft"), 600);
  assert.equal(nextProfilePanelWidth(300, "ArrowRight"), 300);
});

test("profile width persistence is bounded and optional", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  assert.equal(readProfilePanelWidth(storage), 380);
  writeProfilePanelWidth(storage, 720);
  assert.equal(values.get("rah:profile-panel-width"), "600");
  assert.equal(readProfilePanelWidth(storage), 600);
  values.set("rah:profile-panel-width", "broken");
  assert.equal(readProfilePanelWidth(storage), 380);

  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(readProfilePanelWidth(blocked), 380);
  assert.doesNotThrow(() => writeProfilePanelWidth(blocked, 420));
});
