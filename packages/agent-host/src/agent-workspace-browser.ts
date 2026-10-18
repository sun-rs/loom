import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import type {
  AgentWorkspaceFile,
  AgentWorkspaceListing,
  AgentWorkspaceRoot,
} from "../../protocol/src/agent-workspace.ts";
import { agentMemoryWorkspacePath } from "./agent-memory-workspace.ts";

// Port: Raft Computer 1.0.18 workspace filters, types and bounds (see trigger contract).
const NEVER = new Set([
  ".aws",
  ".gnupg",
  ".ssh",
  ".slock",
  ".slock-runtime",
  ".git",
  "node_modules",
  ".rah",
]);
const SECRET = [
  /^\.env(?:\.|$)/i,
  /(?:^|[._-])secret(?:s)?(?:[._-]|$)/i,
  /(?:^|[._-])credential(?:s)?(?:[._-]|$)/i,
  /(?:^|[._-])token(?:s)?(?:[._-]|$)/i,
];
const TEXT = new Set([
  "",
  ".md",
  ".txt",
  ".json",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".yaml",
  ".yml",
  ".toml",
  ".log",
  ".csv",
  ".xml",
  ".html",
  ".css",
  ".sh",
  ".py",
]);
const IMAGE: Record<string, string> = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const forbidden = (name: string) =>
  NEVER.has(name) || name.startsWith(".slock-") || name.startsWith(".rah-");
const secret = (path: string) =>
  path.split("/").some((part) => SECRET.some((p) => p.test(part)));
function pathParts(path: string) {
  if (
    path.length > 4096 ||
    path.startsWith("/") ||
    /[\\\0]/u.test(path) ||
    path.split("/").some((p) => p === ".." || p === "." || forbidden(p))
  )
    throw new Error("Workspace path is not permitted");
  return path.split("/").filter(Boolean);
}
async function safePath(root: string, path: string, referenceOnly = false) {
  const home = await realpath(root);
  if (home === sep && !referenceOnly)
    throw new Error("Filesystem root is not a workspace root");
  const parts = pathParts(path);
  // Revalidate every component, including the Agent home; no symlink traversal.
  let target = home;
  for (const part of ["", ...parts]) {
    target = part ? join(target, part) : target;
    const info = await lstat(target);
    if (
      info.isSymbolicLink() ||
      (!info.isDirectory() && (!info.isFile() || info.nlink !== 1))
    )
      throw new Error("Workspace links and special files are not readable");
  }
  if (
    (await realpath(home)) !== resolve(home) ||
    (await realpath(target)) !== resolve(target) ||
    (target !== home && !target.startsWith(home === sep ? sep : home + sep))
  )
    throw new Error("Workspace path escaped its owner");
  return { home, target };
}
export async function listAgentWorkspace(
  root: string,
  owner: string,
  path = "",
  includeHidden = false,
): Promise<AgentWorkspaceListing> {
  if (!owner.trim()) throw new Error("Agent owner required");
  const rootDirectory = agentMemoryWorkspacePath(await realpath(root), owner);
  return listWorkspaceRoot({
    rootDirectory,
    rootId: "agent-workspace",
    rootKind: "agent-workspace",
    rootLabel: "Agent 工作区",
    path,
    includeHidden,
  });
}

export async function listWorkspaceRoot(input: {
  rootDirectory: string;
  rootId: AgentWorkspaceRoot["rootId"];
  rootKind: AgentWorkspaceRoot["rootKind"];
  rootLabel: string;
  path?: string;
  includeHidden?: boolean;
}): Promise<AgentWorkspaceListing> {
  return listDirectory(input, false);
}

/** Path references may list the host root; workspace previews never inherit this scope. */
export async function listComputerReferenceRoot(
  input: Parameters<typeof listWorkspaceRoot>[0],
) {
  return listDirectory(input, true);
}

async function listDirectory(
  input: Parameters<typeof listWorkspaceRoot>[0],
  referenceOnly: boolean,
): Promise<AgentWorkspaceListing> {
  if (input.rootId !== input.rootKind)
    throw new Error("Workspace root id and kind must agree");
  const path = input.path ?? "";
  const includeHidden = input.includeHidden ?? false;
  const parts = pathParts(path);
  if (!includeHidden && parts.some((p) => p.startsWith(".")))
    throw new Error("Hidden files are not enabled");
  const result: AgentWorkspaceListing = {
    rootId: input.rootId,
    rootLabel: input.rootLabel,
    rootPath: input.rootDirectory,
    rootKind: input.rootKind,
    state: "ready",
    path,
    entries: [],
    truncated: false,
  };
  let target: string;
  try {
    ({ target } = await safePath(input.rootDirectory, path, referenceOnly));
  } catch (error) {
    if (path === "" && (error as NodeJS.ErrnoException).code === "ENOENT")
      return { ...result, state: "absent" };
    throw error;
  }
  const dir = await opendir(target);
  let scanned = 0;
  for await (const entry of dir) {
    if (++scanned > 2000 || result.entries.length === 1000) {
      result.truncated = true;
      break;
    }
    if (
      forbidden(entry.name) ||
      (!includeHidden && entry.name.startsWith(".")) ||
      entry.isSymbolicLink()
    )
      continue;
    const relative = [...parts, entry.name].join("/");
    if (secret(relative)) continue;
    try {
      const checked = await safePath(
        input.rootDirectory,
        relative,
        referenceOnly,
      );
      const info = await lstat(checked.target);
      result.entries.push({
        name: entry.name,
        path: relative,
        isDirectory: info.isDirectory(),
        isHidden: entry.name.startsWith("."),
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
      });
    } catch {
      /* Deleted entries / unsafe links are not exposed. */
    }
  }
  await safePath(input.rootDirectory, path, referenceOnly);
  result.entries.sort(
    (a, b) =>
      Number(b.isDirectory) - Number(a.isDirectory) ||
      a.name.localeCompare(b.name),
  );
  return result;
}
export async function readAgentWorkspace(
  root: string,
  owner: string,
  path: string,
): Promise<AgentWorkspaceFile> {
  if (!owner.trim()) throw new Error("Agent owner required");
  return readWorkspaceRoot({
    rootDirectory: agentMemoryWorkspacePath(await realpath(root), owner),
    rootId: "agent-workspace",
    rootKind: "agent-workspace",
    rootLabel: "Agent 工作区",
    path,
  });
}

export async function readWorkspaceRoot(input: {
  rootDirectory: string;
  rootId: AgentWorkspaceRoot["rootId"];
  rootKind: AgentWorkspaceRoot["rootKind"];
  rootLabel: string;
  path: string;
  allowPdf?: boolean;
}): Promise<AgentWorkspaceFile> {
  if (input.rootId !== input.rootKind)
    throw new Error("Workspace root id and kind must agree");
  const { path } = input;
  if (!path || secret(path))
    throw new Error("Preview is disabled for sensitive workspace files");
  const { target } = await safePath(input.rootDirectory, path);
  const file = await open(
    target,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1)
      throw new Error("Workspace preview requires a regular private file");
    const ext = extname(path).toLowerCase();
    const pdf = input.allowPdf && ext === ".pdf";
    const text = TEXT.has(ext),
      mimeType = pdf
        ? "application/pdf"
        : (IMAGE[ext] ?? "application/octet-stream");
    const base: AgentWorkspaceFile = {
      rootId: input.rootId,
      rootKind: input.rootKind,
      rootLabel: input.rootLabel,
      path,
      size: stat.size,
      content: null,
      encoding: "binary",
      mimeType,
    };
    if (!text && !IMAGE[ext] && !pdf) return base;
    const limit = text ? 1048576 : 5 * 1024 * 1024;
    if (stat.size > limit) {
      if (!text) return base;
      throw new Error("File too large (text preview limit 1 MiB)");
    }
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        size,
        buffer.length - size,
        size,
      );
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > limit) throw new Error("File grew beyond preview limit");
    if (pdf && buffer.subarray(0, 5).toString() !== "%PDF-")
      throw new Error("Invalid PDF file");
    await safePath(input.rootDirectory, path);
    const current = await lstat(target);
    if (
      current.ino !== stat.ino ||
      current.dev !== stat.dev ||
      current.nlink !== 1
    )
      throw new Error("Workspace file changed during read; retry");
    return {
      ...base,
      size,
      encoding: text ? "utf-8" : "base64",
      mimeType: text ? "text/plain" : mimeType,
      content: buffer.subarray(0, size).toString(text ? "utf8" : "base64"),
    };
  } finally {
    await file.close();
  }
}

/** Shared path policy for read-only Git inspection, including deleted leaves. */
export async function assertWorkspacePreviewPath(root: string, path: string) {
  if (!path || secret(path))
    throw new Error("Preview is disabled for sensitive workspace files");
  const parts = pathParts(path);
  try {
    await safePath(root, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await safePath(root, parts.slice(0, -1).join("/"));
  }
}
