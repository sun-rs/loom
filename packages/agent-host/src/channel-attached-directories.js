import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

/**
 * Owner 2026-09-26 channel workspace: how each native CLI learns the
 * Channel's Human-attached directories. Transport only; the directories are
 * chosen and validated at Channel creation, never here.
 */
export function parseAttachedDirectory(value) {
  if (
    typeof value !== "string" ||
    value.length < 2 ||
    value.length > 4_096 ||
    !value.startsWith("/") ||
    value.endsWith("/") ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    value
      .slice(1)
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  )
    throw new Error("--additional-dir must be a normalized absolute path");
  return value;
}

/** Claude Code `--add-dir` is variadic: the `=` form never swallows argv. */
export function claudeAttachedDirectoryArgs(directories) {
  return directories.map((directory) => `--add-dir=${directory}`);
}

/**
 * Codex app-server v2 (experimental API, enabled at initialize):
 * `thread/start` and `thread/resume` replace the thread's workspace roots.
 * Omitted without attached directories so existing threads see no change.
 */
export function codexWorkspaceRoots(cwd, directories) {
  return directories.length === 0
    ? {}
    : { runtimeWorkspaceRoots: [cwd, ...directories] };
}

/**
 * kimi-code 0.39.1 reads `<project root>/.kimi-code/local.toml`
 * `[workspace] additional_dir` at every process start (ACP
 * `additionalDirectories` is ignored on resume). Verified with a free fake
 * provider on 2026-09-26: the list enters the system prompt's
 * `## Additional Directories` on session/new and is kept on resume. The
 * project root is the cwd when it is not inside a git worktree (a channel
 * home). Written atomically and only when the content changes.
 */
export function writeKimiWorkspaceConfig(cwd, directories) {
  if (directories.length === 0) return;
  const directory = join(cwd, ".kimi-code");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("Kimi workspace config directory is not a directory");
  const path = join(directory, "local.toml");
  const text = [
    "# Written by Loom: this Channel's attached directories (immutable).",
    "[workspace]",
    `additional_dir = [${directories.map((d) => JSON.stringify(d)).join(", ")}]`,
    "",
  ].join("\n");
  try {
    if (readFileSync(path, "utf8") === text) return;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
