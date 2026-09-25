// Native session files the paid gates read as diagnostics (never as Room
// truth): Claude Code transcripts and Kimi Code session wires.
import { globSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const one = (paths, what) => {
  if (paths.length !== 1)
    throw new Error(`Expected exactly one ${what}, found ${paths.length}`);
  return paths[0];
};

export function claudeTranscriptPath(sessionId) {
  const home = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  return one(
    globSync(join(home, "projects", "*", `${sessionId}.jsonl`)),
    "Claude transcript",
  );
}

export function readClaudeTranscript(sessionId) {
  return readFileSync(claudeTranscriptPath(sessionId), "utf8");
}

// The main transcript followed by its sub-agent transcripts
// (`<session>/subagents/*.jsonl`, sidechain entries) so the post-hoc model
// fence also covers sub-agent generations; usage stays main-chain only.
export function readClaudeTranscriptWithSubagents(sessionId) {
  const main = claudeTranscriptPath(sessionId);
  const subagents = globSync(
    join(dirname(main), sessionId, "subagents", "*.jsonl"),
  ).sort();
  return [main, ...subagents]
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
}

// Main agent only; subagent wires live beside it and are not counted.
export function kimiWirePath(sessionId) {
  const home = process.env.KIMI_CODE_HOME ?? join(homedir(), ".kimi-code");
  return one(
    globSync(
      join(
        home,
        "sessions",
        "*",
        `session_${sessionId}`,
        "agents/main/wire.jsonl",
      ),
    ),
    "Kimi session wire",
  );
}

export function readKimiWire(sessionId) {
  return readFileSync(kimiWirePath(sessionId), "utf8");
}
