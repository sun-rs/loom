import test from "node:test";
import assert from "node:assert/strict";
import { computerWorkspaceState } from "../src/computer-workspace-state.ts";
test("enabled configuration alone does not prove an active workspace", () => {
  assert.equal(computerWorkspaceState({ state: "enabled" }), "UNKNOWN");
  assert.equal(computerWorkspaceState({ state: "disabled" }), "STOPPED");
  assert.equal(computerWorkspaceState(undefined), "UNKNOWN");
});
