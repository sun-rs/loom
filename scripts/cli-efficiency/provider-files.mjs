// Native session files the paid gates read as diagnostics (never as Room
// truth): Claude Code transcripts and Kimi Code session wires.
import { existsSync, globSync, readFileSync } from "node:fs";
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
// kimi-code 0.39 session ids already carry the `session_` prefix (the ACP
// driver and the print-mode resume hint both report `session_<uuid>`), which
// is also the directory name; a bare id is accepted too. When the
// `sessions/<workspace>/` glob finds nothing, the CLI's own
// `session_index.jsonl` (`sessionDir`) is consulted. Anything but exactly one
// wire throws: an unreadable wire is missing evidence, never a pass.
export function kimiWirePath(sessionId) {
  const home = process.env.KIMI_CODE_HOME ?? join(homedir(), ".kimi-code");
  const directoryName = String(sessionId).startsWith("session_")
    ? String(sessionId)
    : `session_${sessionId}`;
  const globbed = globSync(
    join(home, "sessions", "*", directoryName, "agents/main/wire.jsonl"),
  );
  if (globbed.length > 0) return one(globbed, "Kimi session wire");
  return one(kimiIndexedWires(home, directoryName), "Kimi session wire");
}

function kimiIndexedWires(home, directoryName) {
  const index = join(home, "session_index.jsonl");
  if (!existsSync(index)) return [];
  const dirs = new Set();
  for (const line of readFileSync(index, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      entry?.sessionId === directoryName &&
      typeof entry.sessionDir === "string"
    )
      dirs.add(entry.sessionDir);
  }
  return [...dirs]
    .map((dir) => join(dir, "agents/main/wire.jsonl"))
    .filter((path) => existsSync(path));
}

export function readKimiWire(sessionId) {
  return readFileSync(kimiWirePath(sessionId), "utf8");
}
