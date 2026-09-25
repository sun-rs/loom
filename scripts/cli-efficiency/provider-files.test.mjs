import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readClaudeTranscriptWithSubagents } from "./provider-files.mjs";
import { claudeTranscriptRound } from "./claude-usage.mjs";

test("claude transcript with sub-agent files: sidechain models become visible", () => {
  const home = mkdtempSync(join(tmpdir(), "loom-claude-home-"));
  const project = join(home, "projects", "-w");
  mkdirSync(join(project, "s1", "subagents"), { recursive: true });
  const line = (o) => JSON.stringify(o);
  writeFileSync(
    join(project, "s1.jsonl"),
    line({
      type: "assistant",
      cwd: "/w",
      timestamp: "2026-09-25T00:00:01.000Z",
      message: { id: "m1", model: "claude-haiku-4-5", usage: {} },
    }) + "\n",
  );
  writeFileSync(
    join(project, "s1", "subagents", "agent-a.jsonl"),
    line({
      type: "assistant",
      isSidechain: true,
      timestamp: "2026-09-25T00:00:02.000Z",
      message: { id: "m2", model: "claude-opus-5-5", usage: {} },
    }) + "\n",
  );
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = home;
  try {
    const r = claudeTranscriptRound(readClaudeTranscriptWithSubagents("s1"));
    assert.equal(r.cwd, "/w");
    assert.deepEqual(r.models, ["claude-haiku-4-5"]);
    assert.deepEqual(r.sidechainModels, ["claude-opus-5-5"]);
    assert.equal(r.totals.generations, 1);
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
  }
});
