import { createHash, randomUUID } from "node:crypto";
import { lstat, link, mkdir, open, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import type { AgentRuntimeContext } from "@rah-os/protocol";

import type { ActivationEnvironmentLease } from "./generic-process-adapter.ts";

export const RAH_AGENT_MEMORY_DIR_ENV = "RAH_AGENT_MEMORY_DIR";
export const RAH_AGENT_MEMORY_INDEX_ENV = "RAH_AGENT_MEMORY_INDEX";
export const RAH_AGENT_APP_INBOX_JSON_ENV = "RAH_AGENT_APP_INBOX_JSON";
export const RAFT_MEMORY_INDEX_THRESHOLD_BYTES = 65_536;

export type PreparedAgentMemoryWorkspace = ActivationEnvironmentLease &
  Readonly<{
    memoryIndexPath: string;
    notesPath: string;
    workspacePath: string;
  }>;

export type AgentMemoryIndexInspection =
  | Readonly<{
      bytes: number;
      kind: "within_threshold";
      thresholdBytes: number;
    }>
  | Readonly<{
      bytes: number;
      kind: "over_threshold";
      summary: string;
      thresholdBytes: number;
      title: string;
    }>;

/**
 * Structured port of Raft Computer 1.0.18 `buildInitialMemoryMd`.
 *
 * Frozen source slice:
 * onboarding-and-initial-memory.js, SHA-256
 * e89786a2ad01d5f3e683aad16fa0c3ecf563370a7033d83e7ffd0dbd4cec6fe4.
 */
export function buildRaftCompatibleInitialMemory(input: {
  agentName: string;
  description: string | undefined;
}): string {
  const agentName = requiredText(input.agentName, "agentName", 128);
  const description = optionalText(input.description, "description", 2_000);
  return `# ${agentName}

## Role
${description ?? "No role defined yet."}

## Key Knowledge
- No notes yet.

## Active Context
- First startup.
`;
}

/**
 * Establishes one persistent memory workspace per stable Agent participant.
 * Model, RuntimeProfile, Room and Provider session are deliberately absent
 * from the storage key.
 *
 * The create-if-absent behavior is a structured port of Raft Computer 1.0.18
 * `initializeAgentWorkspace` (slice SHA-256
 * 4786f4ed7efbc088a4074ed41f48b512e0583aa7efb913203b84b8439035a3b2).
 * RAH OS adds private-mode, owner and symlink checks while preserving Raft's
 * seed-once contract.
 */
export async function prepareAgentMemoryWorkspace(input: {
  agent: AgentRuntimeContext;
  rootDirectory: string;
}): Promise<PreparedAgentMemoryWorkspace> {
  if (!isAbsolute(input.rootDirectory)) {
    throw new Error("Agent memory root must be absolute");
  }
  const participantId = requiredText(
    input.agent.participantId,
    "participantId",
    512,
  );
  requiredText(
    input.agent.agentDefinitionRevision.agentDefinitionId,
    "agentDefinitionId",
    512,
  );
  const rootDirectory = resolve(input.rootDirectory);
  await ensurePrivateDirectory(rootDirectory, "Agent memory root");
  const workspacePath = agentMemoryWorkspacePath(rootDirectory, participantId);
  await ensurePrivateDirectory(workspacePath, "Agent memory workspace");
  const notesPath = join(workspacePath, "notes");
  await ensurePrivateDirectory(notesPath, "Agent memory notes directory");

  const revision = input.agent.agentDefinitionRevision;
  const memoryIndexPath = join(workspacePath, "MEMORY.md");
  await createPrivateFileIfMissing(
    memoryIndexPath,
    buildRaftCompatibleInitialMemory({
      agentName: revision.displayName ?? input.agent.handle ?? participantId,
      description: revision.description ?? revision.role,
    }),
  );
  await assertPrivateRegularFile(memoryIndexPath, "Agent memory index");

  return Object.freeze({
    env: Object.freeze({
      [RAH_AGENT_MEMORY_DIR_ENV]: workspacePath,
      [RAH_AGENT_MEMORY_INDEX_ENV]: memoryIndexPath,
    }),
    memoryIndexPath,
    notesPath,
    workspacePath,
  });
}

/**
 * Resolves the opaque Computer-local directory for one stable Agent without
 * creating it. Administrative reset uses this exact owner mapping rather than
 * accepting a caller-provided filesystem path.
 */
export function agentMemoryWorkspacePath(
  rootDirectory: string,
  participantId: string,
): string {
  if (!isAbsolute(rootDirectory)) {
    throw new Error("Agent memory root must be absolute");
  }
  return join(
    resolve(rootDirectory),
    opaqueAgentDirectory(requiredText(participantId, "participantId", 512)),
  );
}

/**
 * Source-compatible first-stage cleaner decision. Raft schedules this check
 * and surfaces an Agent Inbox hint; scheduling/Inbox materialization remains
 * a separate product integration so file ownership stays in AgentHost.
 */
export async function inspectAgentMemoryIndex(
  memoryIndexPath: string,
  thresholdBytes = RAFT_MEMORY_INDEX_THRESHOLD_BYTES,
): Promise<AgentMemoryIndexInspection> {
  if (!isAbsolute(memoryIndexPath)) {
    throw new Error("Agent memory index path must be absolute");
  }
  if (!Number.isSafeInteger(thresholdBytes) || thresholdBytes < 4_096) {
    throw new Error("Agent memory threshold is invalid");
  }
  const metadata = await assertPrivateRegularFile(
    resolve(memoryIndexPath),
    "Agent memory index",
  );
  const bytes = Number(metadata.size);
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error(
      "Agent memory index size is outside the safe integer range",
    );
  }
  if (bytes <= thresholdBytes) {
    return Object.freeze({
      bytes,
      kind: "within_threshold",
      thresholdBytes,
    });
  }
  return Object.freeze({
    bytes,
    kind: "over_threshold",
    summary: "Loaded each session; keep an index and move details to notes.",
    thresholdBytes,
    title: `MEMORY.md is ${formatBytes(bytes)}, over ${formatBytes(thresholdBytes)}`,
  });
}

async function ensurePrivateDirectory(
  path: string,
  label: string,
): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  const metadata = await lstat(path);
  const currentUid = process.getuid?.();
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (currentUid !== undefined && metadata.uid !== currentUid) ||
    (metadata.mode & 0o077) !== 0
  ) {
    throw new Error(`${label} is not private and owner-controlled: ${path}`);
  }
}

async function createPrivateFileIfMissing(
  path: string,
  content: string,
): Promise<void> {
  const temporaryPath = `${path}.${String(process.pid)}-${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporaryPath, path);
      await syncDirectory(dirname(path));
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function assertPrivateRegularFile(
  path: string,
  label: string,
): Promise<Awaited<ReturnType<typeof lstat>>> {
  const metadata = await lstat(path);
  const currentUid = process.getuid?.();
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (currentUid !== undefined && metadata.uid !== currentUid) ||
    (metadata.mode & 0o077) !== 0
  ) {
    throw new Error(`${label} is not a private regular file: ${path}`);
  }
  return metadata;
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function opaqueAgentDirectory(participantId: string): string {
  return createHash("sha256").update(participantId).digest("hex");
}

function requiredText(value: unknown, name: string, limit: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  if (value.length > limit || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${name} is invalid or exceeds its safe limit`);
  }
  return value;
}

function optionalText(
  value: unknown,
  name: string,
  limit: number,
): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, name, limit);
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_024 * 1_024 * 1_024) {
    return `${(bytes / (1_024 * 1_024 * 1_024)).toFixed(1)} GiB`;
  }
  if (bytes >= 1_024 * 1_024) {
    return `${(bytes / (1_024 * 1_024)).toFixed(1)} MiB`;
  }
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${String(bytes)} B`;
}
