import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import type {
  AgentSkill,
  AgentSkillsIssue,
  AgentSkillsScope,
} from "../../protocol/src/agent-skills.ts";

// Structural port of Raft Computer 1.0.18 AgentManager.listSkills/scanSkillsDir.
// Only metadata leaves AgentHost. Unlike upstream, reads, traversal and failures are bounded.
const HEADER_BYTES = 16_384;
const within = (path: string, root: string) =>
  path === root || path.startsWith(root + sep);
const empty = (): AgentSkillsScope => ({
  state: "ready",
  skills: [],
  truncated: false,
  issues: [],
});
export function unavailableAgentSkills(
  issue: AgentSkillsIssue,
): AgentSkillsScope {
  return { ...empty(), state: "unavailable", issues: [issue] };
}
class ScanError extends Error {
  readonly issue: AgentSkillsIssue;
  constructor(issue: AgentSkillsIssue) {
    super(issue);
    this.issue = issue;
  }
}
function issueOf(error: unknown): AgentSkillsIssue {
  return error instanceof ScanError ? error.issue : "read_failed";
}
function missing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

// Global personal-config isolation (2026-09-26): Loom launches Claude with
// `--setting-sources project,local` (no ~/.claude skills or commands) and
// Codex with `skills.include_instructions=false` (no skill listing at all),
// see provider-launch-arguments.js. The Human's global skill directories are
// therefore never presented as available to an instance, and are not read.
export async function scanAgentSkills(input: {
  cliId: string;
  home: string;
  workspaceRoot: string;
  limits?: { entries?: number };
}): Promise<{ global: AgentSkillsScope; workspace: AgentSkillsScope }> {
  if (!["claude", "codex"].includes(input.cliId))
    return {
      global: unavailableAgentSkills("unsupported_runtime"),
      workspace: unavailableAgentSkills("unsupported_runtime"),
    };
  const isolated = unavailableAgentSkills("isolated_by_loom");
  if (input.cliId === "codex")
    return {
      global: isolated,
      workspace: unavailableAgentSkills("isolated_by_loom"),
    };
  return {
    global: isolated,
    workspace: await scanScope({
      directories: [".claude/skills", ".claude/commands"].map((path) =>
        join(input.workspaceRoot, path),
      ),
      approvedRoots: [input.workspaceRoot],
      home: input.home,
      privateRoot: true,
      maxEntries: input.limits?.entries ?? 1000,
    }),
  };
}

async function scanScope(input: {
  directories: string[];
  approvedRoots: string[];
  home: string;
  privateRoot: boolean;
  maxEntries: number;
}): Promise<AgentSkillsScope> {
  const result = empty();
  const issues = new Set<AgentSkillsIssue>();
  const approved: string[] = [];
  let scanned = 0;
  const seen = new Set<string>();
  try {
    for (const root of input.approvedRoots) {
      if (!isAbsolute(root) || resolve(root) === sep)
        throw new ScanError("blocked_path");
      try {
        const canonical = await realpath(root);
        if (
          input.privateRoot &&
          (canonical !== resolve(root) || (await lstat(root)).isSymbolicLink())
        )
          throw new ScanError("blocked_path");
        approved.push(canonical);
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
  } catch (error) {
    return { ...result, state: "error", issues: [issueOf(error)] };
  }
  for (const directory of input.directories) {
    if (result.truncated) break;
    try {
      const canonical = await safeTarget(
        directory,
        approved,
        input.privateRoot,
      );
      const dir = await opendir(canonical);
      const entries = [];
      for await (const entry of dir) {
        if (++scanned > Math.min(1000, input.maxEntries)) {
          result.truncated = true;
          issues.add("scan_limit");
          break;
        }
        entries.push(entry);
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const name = entry.name;
        if (name.length > 512 || name.startsWith(".")) continue;
        const entryPath = join(directory, name);
        const file =
          entry.isDirectory() || entry.isSymbolicLink()
            ? join(entryPath, "SKILL.md")
            : name.endsWith(".md")
              ? entryPath
              : undefined;
        if (!file) continue;
        try {
          const metadata = await readMetadata(
            file,
            approved,
            input.privateRoot,
          );
          const skillName =
            name.endsWith(".md") &&
            !entry.isDirectory() &&
            !entry.isSymbolicLink()
              ? name.slice(0, -3)
              : name;
          if (!skillName || seen.has(skillName)) continue;
          const sourcePath = within(directory, input.home)
            ? `~${directory.slice(input.home.length)}`
            : directory;
          result.skills.push(parseMetadata(skillName, metadata, sourcePath));
          seen.add(skillName);
        } catch (error) {
          if (!missing(error)) issues.add(issueOf(error));
        }
      }
    } catch (error) {
      if (!missing(error)) issues.add(issueOf(error));
    }
  }
  result.issues = [...issues];
  result.state = issues.size
    ? result.skills.length
      ? "partial"
      : "error"
    : "ready";
  return result;
}

async function safeTarget(path: string, roots: string[], privateRoot: boolean) {
  const canonical = await realpath(path);
  if (
    !roots.some((root) => within(canonical, root)) ||
    (privateRoot && canonical !== resolve(path))
  )
    throw new ScanError("blocked_path");
  return canonical;
}
async function readMetadata(
  path: string,
  roots: string[],
  privateRoot: boolean,
) {
  const canonical = await safeTarget(path, roots, privateRoot);
  const before = await lstat(canonical);
  if (!before.isFile() || before.nlink !== 1)
    throw new ScanError("blocked_path");
  const file = await open(
    canonical,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const opened = await file.stat();
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.ino !== before.ino ||
      opened.dev !== before.dev
    )
      throw new ScanError("blocked_path");
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await file.read(buffer, 0, HEADER_BYTES, 0);
    const after = await lstat(canonical);
    if (
      (await safeTarget(path, roots, privateRoot)) !== canonical ||
      after.ino !== opened.ino ||
      after.dev !== opened.dev
    )
      throw new ScanError("blocked_path");
    const prefix = buffer
      .subarray(0, bytesRead)
      .toString("utf8")
      .replaceAll("\r\n", "\n");
    if (!prefix.startsWith("---\n")) return "";
    const end = prefix.indexOf("\n---", 4);
    if (end < 0) throw new ScanError("metadata_limit");
    return prefix.slice(4, end);
  } finally {
    await file.close();
  }
}
function parseMetadata(
  name: string,
  metadata: string,
  sourcePath: string,
): AgentSkill {
  const skill: AgentSkill = {
    name,
    displayName: name,
    description: "",
    userInvocable: false,
    sourcePath,
  };
  for (const line of metadata.split("\n")) {
    const index = line.indexOf(":");
    if (index < 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key === "name" && value) skill.displayName = value;
    else if (key === "description") skill.description = value;
    else if (key === "user-invocable") skill.userInvocable = value === "true";
  }
  if (skill.displayName.length > 512 || skill.description.length > 8192)
    throw new ScanError("metadata_limit");
  return skill;
}
