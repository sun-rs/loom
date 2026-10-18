import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { basename, join, relative, isAbsolute } from "node:path";
import type {
  ChannelWorkspace,
  ChannelWorkspaceReadRequest,
  ChannelWorkspaceReadResponse,
  AgentWorkspaceRoot,
} from "@rah-os/protocol";
import {
  assertWorkspacePreviewPath,
  listWorkspaceRoot,
  readWorkspaceRoot,
} from "./agent-workspace-browser.ts";

/** Host-owned read-only filesystem/Git adapter. No shell, diff helpers or writes. */
export async function readChannelWorkspace(
  workspace: ChannelWorkspace,
  input: ChannelWorkspaceReadRequest,
): Promise<ChannelWorkspaceReadResponse> {
  const paths: [AgentWorkspaceRoot["rootId"], string][] = [];
  if (workspace.primaryDirectory)
    paths.push(["runtime-project", workspace.primaryDirectory]);
  workspace.additionalDirectories.forEach((path, i) =>
    paths.push([
      `attached-project-${i + 1}` as AgentWorkspaceRoot["rootId"],
      path,
    ]),
  );
  const roots: AgentWorkspaceRoot[] = await Promise.all(
    paths.map(async ([rootId, rootPath]) => ({
      rootId,
      rootKind: rootId,
      rootPath,
      label:
        rootId === "runtime-project"
          ? "频道工作区"
          : (basename(rootPath) || "附加目录").slice(0, 96),
      state: await lstat(rootPath).then(
        (s) =>
          s.isDirectory() && !s.isSymbolicLink()
            ? ("ready" as const)
            : ("absent" as const),
        () => "absent" as const,
      ),
    })),
  );
  if (input.operation === "roots") {
    if (!roots.length) throw new Error("此频道尚无固定工作区目录");
    return { kind: "roots", value: { defaultRootId: roots[0]!.rootId, roots } };
  }
  const root = roots.find((r) => r.rootId === input.rootId);
  if (!root || root.state !== "ready") throw new Error("工作区目录不可用");
  const options = {
    rootDirectory: root.rootPath,
    rootId: root.rootId,
    rootKind: root.rootKind,
    rootLabel: root.label,
    path: input.path,
    includeHidden: input.includeHidden,
  };
  if (input.operation === "list")
    return { kind: "list", value: await listWorkspaceRoot(options) };
  if (input.operation === "read")
    return {
      kind: "read",
      value: await readWorkspaceRoot({ ...options, allowPdf: true }),
    };
  const home = await realpath(root.rootPath);
  // Git owns repository discovery (including linked worktrees); the fixed
  // channel directory remains the filesystem authorization boundary.
  const repository = await realpath(
    (await git(home, ["rev-parse", "--show-toplevel"])).trim(),
  );
  const scope = relative(repository, home);
  if (scope.startsWith("..") || isAbsolute(scope))
    throw new Error("Git repository scope mismatch");
  const metadata = await lstat(join(repository, ".git")).catch(() => null);
  if (
    !metadata ||
    metadata.isSymbolicLink() ||
    (!metadata.isDirectory() && !metadata.isFile())
  )
    throw new Error(
      "Git metadata must be a regular directory or worktree pointer",
    );
  if (input.operation === "changes") {
    const raw = await git(home, [
      "status",
      "--porcelain=v1",
      "-z",
      "--no-renames",
      "--untracked-files=all",
      "--",
      ".",
    ]);
    const entries: { path: string; status: string }[] = [];
    let truncated = false;
    for (const row of raw.split("\0")) {
      if (!row) continue;
      const path = relative(home, join(repository, row.slice(3)));
      if (!path || path.startsWith("..") || isAbsolute(path)) continue;
      try {
        await assertWorkspacePreviewPath(home, path);
      } catch {
        continue;
      }
      if (entries.length === 500) {
        truncated = true;
        break;
      }
      entries.push({ status: row.slice(0, 2), path });
    }
    return { kind: "changes", entries, truncated };
  }
  await assertWorkspacePreviewPath(home, input.path);
  const tracked = await git(home, [
    "ls-files",
    "--error-unmatch",
    "--",
    input.path,
  ]).then(
    () => true,
    () => false,
  );
  const hasHead = await git(home, ["rev-parse", "--verify", "HEAD"]).then(
    () => true,
    () => false,
  );
  const args =
    tracked && hasHead
      ? [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
          "HEAD",
          "--",
          input.path,
        ]
      : [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--no-index",
          "--",
          "/dev/null",
          input.path,
        ];
  const text = await git(home, args, true);
  await assertWorkspacePreviewPath(home, input.path);
  return { kind: "diff", text, path: input.path };
}
function git(cwd: string, args: string[], diff = false): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(
      "git",
      [
        "--no-pager",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        ...args,
      ],
      {
        cwd,
        encoding: "utf8",
        timeout: 10000,
        maxBuffer: 524288,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) => !key.startsWith("GIT_"),
            ),
          ),
          GIT_OPTIONAL_LOCKS: "0",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_LITERAL_PATHSPECS: "1",
        },
      },
      (error, stdout) => {
        if (error && !(diff && Number(error.code) === 1))
          reject(
            new Error("Git 读取失败、超时或结果超过 512 KiB，请在本机检查"),
          );
        else resolve(stdout);
      },
    ),
  );
}
