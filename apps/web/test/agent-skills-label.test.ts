import assert from "node:assert/strict";
import test from "node:test";
import { skillSourceLabel } from "../src/agent-skills-presentation.ts";
test("Codex skill labels are relative to its CLI home without rewriting other roots", () => {
  assert.equal(skillSourceLabel("~/.codex/skills"), "~/skills");
  assert.equal(skillSourceLabel("~/.codex/skills/.system"), "~/skills/.system");
  for (const path of [
    "~/.codex/skills-backup",
    "/project/.codex/skills",
    "~/custom/skills",
    "~/.claude/skills",
  ])
    assert.equal(skillSourceLabel(path), path);
});
