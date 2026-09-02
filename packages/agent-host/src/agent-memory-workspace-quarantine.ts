import { createHash } from "node:crypto";
import { lstat, mkdir, open, rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { agentMemoryWorkspacePath } from "./agent-memory-workspace.ts";

export type AgentMemoryWorkspaceQuarantine = Readonly<{
  kind: "already_absent" | "quarantined";
  operationId: string;
  ownerParticipantId: string;
  quarantinePath?: string;
  resetAtMs: number;
  commit(): void;
  rollback(): Promise<void>;
}>;

/**
 * Moves only the opaque, Computer-owned Agent workspace. The caller must
 * already own the global per-Agent terminal fence; this primitive deliberately
 * knows nothing about Provider continuity or runtime-project cwd.
 */
export async function quarantineAgentMemoryWorkspace(input: {
  now: () => number;
  operationId: string;
  ownerParticipantId: string;
  rootDirectory: string;
}): Promise<AgentMemoryWorkspaceQuarantine> {
  const resetAtMs = safeEpoch(input.now());
  await ensurePrivateDirectory(input.rootDirectory, "Agent memory root");
  const workspacePath = agentMemoryWorkspacePath(
    input.rootDirectory,
    input.ownerParticipantId,
  );
  const quarantineRoot = join(input.rootDirectory, ".quarantine");
  await ensurePrivateDirectory(quarantineRoot, "Agent memory quarantine root");
  const quarantinePath = join(
    quarantineRoot,
    `${basename(workspacePath)}.${createHash("sha256")
      .update(input.operationId)
      .digest("hex")}`,
  );
  const workspaceExists = await pathExists(workspacePath);
  const quarantineExists = await pathExists(quarantinePath);
  if (workspaceExists && quarantineExists) {
    throw new Error(
      "Agent workspace reset found both active and quarantined operation state",
    );
  }
  if (workspaceExists) {
    await assertPrivateDirectory(workspacePath, "Agent memory workspace");
    await rename(workspacePath, quarantinePath);
    await syncDirectory(dirname(workspacePath));
  } else if (quarantineExists) {
    await assertPrivateDirectory(
      quarantinePath,
      "Agent memory quarantined workspace",
    );
  }

  const moved = workspaceExists || quarantineExists;
  let active = true;
  return Object.freeze({
    kind: moved ? "quarantined" : "already_absent",
    operationId: input.operationId,
    ownerParticipantId: input.ownerParticipantId,
    ...(moved ? { quarantinePath } : {}),
    resetAtMs,
    commit: () => {
      active = false;
    },
    rollback: async () => {
      if (!active || !moved) return;
      if (await pathExists(workspacePath)) {
        throw new Error(
          "Agent workspace reset rollback would overwrite an active workspace",
        );
      }
      if (!(await pathExists(quarantinePath))) {
        throw new Error(
          "Agent workspace reset rollback lost its quarantined workspace",
        );
      }
      await rename(quarantinePath, workspacePath);
      await syncDirectory(dirname(workspacePath));
      active = false;
    },
  });
}

async function ensurePrivateDirectory(
  path: string,
  label: string,
): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  await assertPrivateDirectory(path, label);
}

async function assertPrivateDirectory(
  path: string,
  label: string,
): Promise<void> {
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function safeEpoch(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Agent memory coordinator clock is invalid");
  }
  return value;
}
