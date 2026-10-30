import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { allocateAgentAvatarKey } from "../src/agent-avatar-allocation.ts";

test("automatic avatars choose unused official presets and stay Workspace scoped", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE agent_definitions(participant_id TEXT, control_room_id TEXT, current_revision_id TEXT); CREATE TABLE agent_definition_revisions(agent_definition_revision_id TEXT, definition_json TEXT)",
    );
    db.prepare("INSERT INTO agent_definitions VALUES(?, ?, ?)").run(
      "alice",
      "control",
      "r1",
    );
    db.prepare("INSERT INTO agent_definition_revisions VALUES(?, ?)").run(
      "r1",
      JSON.stringify({ avatarKey: "robot" }),
    );
    assert.equal(
      allocateAgentAvatarKey(db, "control", () => 0),
      "antenna",
    );
    assert.equal(
      allocateAgentAvatarKey(db, "other", () => 0),
      "robot",
    );
  } finally {
    db.close();
  }
});
