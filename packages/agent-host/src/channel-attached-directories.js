import {
  closeSync,
  constants,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
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
 * home).
 *
 * Review 2026-09-26 P1-2: the file is created only when absent and replaced
 * only while it is still an unmodified Loom-managed version (its first line
 * carries the digest of the rest). Any other existing file is kept and the
 * launch fails with a diagnosable code; a symlink or special file is
 * refused. Creation publishes with an exclusive link, so two instances of
 * one Channel starting together both succeed with one identical file.
 */
export function writeKimiWorkspaceConfig(cwd, directories) {
  if (directories.length === 0) return;
  const directory = join(cwd, ".kimi-code");
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
      throw error;
  }
  const directoryStat = lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
    throw kimiConfigError(
      "KIMI_LOCAL_CONFIG_UNSAFE",
      `${directory} is not a plain directory`,
    );
  const path = join(directory, "local.toml");
  const text = kimiWorkspaceConfigText(directories);
  const existing = readExistingKimiConfig(path);
  if (existing === text) return;
  if (existing !== undefined) assertLoomManagedKimiConfig(path, existing);
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    if (existing === undefined) {
      try {
        linkSync(temporary, path);
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        ))
          throw error;
        // Another instance published first: identical content is success.
        const raced = readExistingKimiConfig(path);
        if (raced !== text) {
          if (raced !== undefined) assertLoomManagedKimiConfig(path, raced);
          throw kimiConfigError(
            "KIMI_LOCAL_CONFIG_MODIFIED",
            `${path} changed while Loom was creating it; kept as it is`,
          );
        }
      }
    } else {
      renameSync(temporary, path);
    }
  } finally {
    rmSync(temporary, { force: true });
  }
}

const KIMI_MARKER = "# Managed by Loom (kimi-workspace v1 sha256:";
const LEGACY_KIMI_HEADER =
  "# Written by Loom: this Channel's attached directories (immutable).";

function kimiWorkspaceConfigText(directories) {
  const body = [
    "[workspace]",
    `additional_dir = [${directories.map((d) => JSON.stringify(d)).join(", ")}]`,
    "",
  ].join("\n");
  return `${KIMI_MARKER}${sha256(body)}). Loom never overwrites an edited copy.\n${body}`;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

/** Regular file contents, undefined when absent; refuses anything else. */
function readExistingKimiConfig(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink())
    throw kimiConfigError(
      "KIMI_LOCAL_CONFIG_UNSAFE",
      `${path} is not a plain regular file`,
    );
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

function assertLoomManagedKimiConfig(path, text) {
  const newline = text.indexOf("\n");
  const header = newline < 0 ? text : text.slice(0, newline);
  const body = newline < 0 ? "" : text.slice(newline + 1);
  if (header.startsWith(KIMI_MARKER)) {
    const digest = header.slice(KIMI_MARKER.length, KIMI_MARKER.length + 64);
    if (digest === sha256(body) && text === headerFor(header, body)) return;
    throw kimiConfigError(
      "KIMI_LOCAL_CONFIG_MODIFIED",
      `${path} is a Loom-managed file that was edited; kept as it is (remove it to let Loom recreate it)`,
    );
  }
  if (header === LEGACY_KIMI_HEADER && isLegacyKimiBody(body)) return;
  throw kimiConfigError(
    "KIMI_LOCAL_CONFIG_FOREIGN",
    `${path} exists and was not written by Loom; kept as it is (merge [workspace] additional_dir yourself or remove the file)`,
  );
}

function headerFor(header, body) {
  return `${header}\n${body}`;
}

/** The first release wrote exactly this shape (2026-09-26, 95ce08a). */
function isLegacyKimiBody(body) {
  const match =
    /^\[workspace\]\nadditional_dir = \[((?:"[^"\\\n]*"(?:, )?)*)\]\n$/u.exec(
      body,
    );
  if (match === null) return false;
  const list = JSON.parse(`[${match[1]}]`);
  return (
    Array.isArray(list) &&
    body ===
      `[workspace]\nadditional_dir = [${list.map((d) => JSON.stringify(d)).join(", ")}]\n`
  );
}

function kimiConfigError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}
