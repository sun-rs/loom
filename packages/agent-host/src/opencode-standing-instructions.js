// S2-c3 standing-rule placement for OpenCode. OpenCode 1.18.32 rebuilds the
// system of EVERY model request (`LLMRequestPrep.prepare`: agent prompt or the
// provider default, then the environment, every configured `instructions`
// file read fresh as "Instructions from: <path>\n<content>", MCP and skills,
// then only the LAST user message's own `system`). Auto-compaction inserts a
// synthetic "Continue…" user message without `system`, so a per-message
// `system` silently vanishes from every later step of that run. An
// `instructions` file of the server's config does not: the rules ride in the
// system layer of every request, including the autocontinue step, and the
// provider default prompt (tool guidance) is kept, which a custom agent
// `prompt` would replace.
//
// The file is content-addressed (sha256 of the rules) in an owner-private
// directory, so the same rules keep the same path and the system prefix — and
// the provider's prompt cache — stays identical across turns, while changed
// rules take effect on the next request. It holds only the standing prompt
// (no Worker credential). Files for superseded rules are tiny and not
// deleted: a concurrent run of the same instance may still read them.
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function openCodeInstructionsDirectory() {
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  return join(tmpdir(), `rah-os-opencode-rules-${String(uid)}`);
}

function assertPrivateDirectory(directory) {
  const stat = lstatSync(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  )
    throw new Error("OpenCode instructions directory is not owner-private");
  if ((stat.mode & 0o077) !== 0) chmodSync(directory, 0o700);
}

function readPrivateFile(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return undefined;
  }
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      (stat.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())
    )
      return undefined;
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

/** Writes (or reuses) the rules file and returns its absolute path. */
export function prepareOpenCodeInstructionsFile(
  rules,
  directory = openCodeInstructionsDirectory(),
) {
  if (typeof rules !== "string" || rules.trim() === "")
    throw new Error("OpenCode standing instructions are empty");
  mkdirSync(directory, { mode: 0o700, recursive: true });
  assertPrivateDirectory(directory);
  const digest = createHash("sha256").update(rules, "utf8").digest("hex");
  const path = join(directory, `rah-standing-${digest}.md`);
  if (readPrivateFile(path) === rules) return path;
  const temporary = join(
    directory,
    `.rah-standing-${digest}.${String(process.pid)}.${randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    writeFileSync(temporary, rules, { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  if (readPrivateFile(path) !== rules)
    throw new Error(
      "OpenCode standing instructions file could not be verified",
    );
  return path;
}

/**
 * `OPENCODE_CONFIG_CONTENT` with the rules file appended to `instructions`;
 * an inherited value is merged, never replaced. Unparseable inherited config
 * fails closed instead of silently dropping the rules.
 */
export function openCodeConfigContentWithInstructions(inherited, path) {
  let config = {};
  if (inherited !== undefined && inherited.trim() !== "") {
    try {
      config = JSON.parse(inherited);
    } catch {
      throw new Error("inherited OPENCODE_CONFIG_CONTENT is not JSON");
    }
    if (typeof config !== "object" || config === null || Array.isArray(config))
      throw new Error("inherited OPENCODE_CONFIG_CONTENT is not an object");
  }
  const existing = Array.isArray(config.instructions)
    ? config.instructions.filter((value) => typeof value === "string")
    : [];
  return JSON.stringify({
    ...config,
    instructions: [...existing.filter((value) => value !== path), path],
  });
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
let lastMillis = 0;
let counter = 0;

/**
 * A caller-chosen user message id in OpenCode's own ascending format
 * (`Identifier.ascending("message")`: "msg_" + 12 hex digits of
 * `millis * 4096 + counter` + 14 random base62), as the official TUI client
 * generates for its prompts, so ordering by id matches creation order.
 */
export function openCodeMessageId(now = Date.now()) {
  if (now !== lastMillis) {
    lastMillis = now;
    counter = 0;
  }
  counter += 1;
  const value = BigInt(now) * 4096n + BigInt(counter);
  const hex = value.toString(16).padStart(12, "0").slice(-12);
  const random = randomBytes(14);
  let suffix = "";
  for (const byte of random) suffix += BASE62[byte % 62];
  return `msg_${hex}${suffix}`;
}
