import assert from "node:assert/strict";
import test from "node:test";
import {
  profileEditorKeyAction,
  validProfileField,
} from "../src/agent-profile-edit.ts";

test("inline profile keyboard follows Raft field semantics and protects IME/pending", () => {
  assert.equal(
    profileEditorKeyAction("displayName", "Enter", false, false),
    "save",
  );
  assert.equal(
    profileEditorKeyAction("description", "Enter", false, false),
    undefined,
  );
  assert.equal(
    profileEditorKeyAction("displayName", "Enter", true, false),
    undefined,
  );
  assert.equal(
    profileEditorKeyAction("description", "Escape", false, false),
    "cancel",
  );
  assert.equal(
    profileEditorKeyAction("displayName", "Escape", false, true),
    undefined,
  );
});
test("inline validation preserves description newlines but rejects blank/oversized names", () => {
  assert.equal(validProfileField("displayName", "  "), false);
  assert.equal(validProfileField("displayName", "a".repeat(129)), false);
  assert.equal(validProfileField("displayName", "a\nb"), false);
  assert.equal(validProfileField("description", "a\nb"), true);
  assert.equal(validProfileField("description", ""), true);
  assert.equal(validProfileField("description", "a".repeat(2001)), false);
});
