import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  link,
  mkdir,
  open,
  opendir,
  readFile,
  rm,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  AgentMemoryMaterializationReceiptSchema,
  AgentMemoryRelativePathSchema,
  AgentMemoryRunSourceSchema,
  AgentMemoryWorkspaceSnapshotSchema,
  type AgentMemoryMaterializationReceipt,
  type AgentMemoryMaterializedFile,
  type AgentMemoryWorkspaceSnapshot,
  type AgentRuntimeContext,
  type AgentMemoryRunSource,
} from "@rah-os/protocol";

import {
  agentMemoryWorkspacePath,
  RAFT_MEMORY_INDEX_THRESHOLD_BYTES,
  type PreparedAgentMemoryWorkspace,
} from "./agent-memory-workspace.ts";

const RECEIPT_DIRECTORY = ".materialization-receipts";
const MAX_NOTE_FILES = 4_096;
export const AGENT_MEMORY_MAX_READ_BYTES = 1_048_576;

export type AgentMemoryMaterializationIdentity = Readonly<{
  activationId: string;
  computerHostId: string;
  roomId: string;
  runAttemptId: string;
}>;

/**
 * Records only the Agent-owned index observed before one RunAttempt launched.
 * Notes are deliberately not enumerated or read on the launch path. Neither
 * this receipt nor a legacy full-tree receipt proves model read/use or backup.
 */
export async function materializeAgentMemoryForRun(input: {
  activation: AgentMemoryMaterializationIdentity;
  agent: AgentRuntimeContext;
  now?: () => number;
  prepared: PreparedAgentMemoryWorkspace;
  rootDirectory: string;
  source?: AgentMemoryRunSource;
}): Promise<AgentMemoryMaterializationReceipt> {
  const rootDirectory = requireAbsolute(input.rootDirectory);
  const source = AgentMemoryRunSourceSchema.optional().parse(input.source);
  const workspacePath = agentMemoryWorkspacePath(
    rootDirectory,
    input.agent.participantId,
  );
  if (
    input.prepared.workspacePath !== workspacePath ||
    input.prepared.memoryIndexPath !== join(workspacePath, "MEMORY.md") ||
    input.prepared.notesPath !== join(workspacePath, "notes")
  ) {
    throw new Error(
      "Agent memory materialization paths do not match their owner",
    );
  }
  for (const path of [rootDirectory, workspacePath, input.prepared.notesPath]) {
    assertPrivateDirectoryMetadata(
      await lstat(path),
      path,
      "Agent memory root/directory",
    );
  }
  const existing = await readAgentMemoryMaterializationReceipt({
    rootDirectory,
    runAttemptId: input.activation.runAttemptId,
  });
  if (existing?.schemaVersion === 1) {
    throw new Error(
      "Legacy memory receipt cannot be revalidated as index-only; use a new RunAttempt",
    );
  }

  const files = [
    await inspectStableFile(input.prepared.memoryIndexPath, "MEMORY.md"),
  ];
  const receiptId = digestText(
    [
      "rah-agent-memory-index-v2",
      input.activation.computerHostId,
      input.activation.runAttemptId,
      input.activation.activationId,
      input.activation.roomId,
      input.agent.participantId,
      input.agent.agentDefinitionRevision.agentDefinitionRevisionId,
      digestJson(input.agent.agentDefinitionRevision.memoryPolicyRef),
      files[0]!.contentDigest,
      ...(source === undefined ? [] : [digestJson(source)]),
    ].join("\n"),
  );
  const candidate = AgentMemoryMaterializationReceiptSchema.parse({
    activationId: input.activation.activationId,
    agentDefinitionRevisionId:
      input.agent.agentDefinitionRevision.agentDefinitionRevisionId,
    computerHostId: input.activation.computerHostId,
    coverage: "index_only",
    files,
    materializedAt: new Date(
      safeEpoch((input.now ?? Date.now)()),
    ).toISOString(),
    memoryPolicyRef: input.agent.agentDefinitionRevision.memoryPolicyRef,
    ownerParticipantId: input.agent.participantId,
    proofScope: "computer_materialized_not_model_read",
    receiptId,
    roomId: input.activation.roomId,
    runAttemptId: input.activation.runAttemptId,
    schemaVersion: 2,
    ...(source === undefined ? {} : { source }),
  });

  if (existing !== null) return assertSameMaterialization(existing, candidate);

  const receiptDirectory = join(rootDirectory, RECEIPT_DIRECTORY);
  await ensurePrivateDirectory(
    receiptDirectory,
    "Agent memory receipt directory",
  );
  const receiptPath = receiptFilePath(rootDirectory, candidate.runAttemptId);
  const temporaryPath = `${receiptPath}.${String(process.pid)}.${candidate.receiptId.slice(7, 23)}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(candidate)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporaryPath, receiptPath);
      await syncDirectory(receiptDirectory);
      return candidate;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const concurrent = await readAgentMemoryMaterializationReceipt({
        rootDirectory,
        runAttemptId: candidate.runAttemptId,
      });
      if (concurrent === null) {
        throw new Error(
          "Agent memory materialization receipt race was not durable",
        );
      }
      return assertSameMaterialization(concurrent, candidate);
    }
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function readAgentMemoryMaterializationReceipt(input: {
  rootDirectory: string;
  runAttemptId: string;
}): Promise<AgentMemoryMaterializationReceipt | null> {
  const rootDirectory = requireAbsolute(input.rootDirectory);
  const path = receiptFilePath(
    rootDirectory,
    requiredText(input.runAttemptId, "runAttemptId"),
  );
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  assertPrivateRegularFileMetadata(
    metadata,
    path,
    "Agent memory materialization receipt",
  );
  const encoded = await readFile(path, "utf8");
  let decoded: unknown;
  try {
    decoded = JSON.parse(encoded);
  } catch (error) {
    throw new Error("Agent memory materialization receipt is not valid JSON", {
      cause: error,
    });
  }
  const receipt = AgentMemoryMaterializationReceiptSchema.parse(decoded);
  if (receipt.runAttemptId !== input.runAttemptId) {
    throw new Error("Agent memory materialization receipt identity mismatch");
  }
  return receipt;
}

/** Returns only metadata safe for the authenticated Human client. */
export async function inspectAgentMemoryWorkspace(input: {
  ownerParticipantId: string;
  rootDirectory: string;
}): Promise<AgentMemoryWorkspaceSnapshot> {
  const rootDirectory = requireAbsolute(input.rootDirectory);
  const ownerParticipantId = requiredText(
    input.ownerParticipantId,
    "ownerParticipantId",
  );
  const workspacePath = agentMemoryWorkspacePath(
    rootDirectory,
    ownerParticipantId,
  );
  let workspaceMetadata;
  try {
    workspaceMetadata = await lstat(workspacePath);
  } catch (error) {
    if (isMissing(error)) {
      return AgentMemoryWorkspaceSnapshotSchema.parse({
        files: [],
        ownerParticipantId,
        schemaVersion: 1,
        state: "absent",
        thresholdBytes: RAFT_MEMORY_INDEX_THRESHOLD_BYTES,
      });
    }
    throw error;
  }
  assertPrivateDirectoryMetadata(
    workspaceMetadata,
    workspacePath,
    "Agent memory workspace",
  );
  const memoryIndexPath = join(workspacePath, "MEMORY.md");
  const notesPath = join(workspacePath, "notes");
  const files = [
    await inspectStableFile(memoryIndexPath, "MEMORY.md"),
    ...(await inspectNotesTree(notesPath)),
  ];
  return AgentMemoryWorkspaceSnapshotSchema.parse({
    files,
    indexOverThreshold:
      (files[0]?.bytes ?? 0) > RAFT_MEMORY_INDEX_THRESHOLD_BYTES,
    noteCount: files.length - 1,
    ownerParticipantId,
    schemaVersion: 1,
    state: "ready",
    thresholdBytes: RAFT_MEMORY_INDEX_THRESHOLD_BYTES,
  });
}

export async function readAgentMemoryWorkspaceFile(input: {
  ownerParticipantId: string;
  relativePath: string;
  rootDirectory: string;
}): Promise<
  Readonly<{
    content: string;
    file: AgentMemoryMaterializedFile;
    ownerParticipantId: string;
  }>
> {
  const rootDirectory = requireAbsolute(input.rootDirectory);
  const ownerParticipantId = requiredText(
    input.ownerParticipantId,
    "ownerParticipantId",
  );
  const relativePath = AgentMemoryRelativePathSchema.parse(input.relativePath);
  const workspacePath = agentMemoryWorkspacePath(
    rootDirectory,
    ownerParticipantId,
  );
  const path = join(workspacePath, ...relativePath.split("/"));
  assertPathInside(workspacePath, path);
  await assertMemoryReadParents(rootDirectory, workspacePath, relativePath);
  const before = await inspectStableFile(path, relativePath);
  if (before.bytes > AGENT_MEMORY_MAX_READ_BYTES) {
    throw new Error(
      `Agent memory browser read exceeds ${String(AGENT_MEMORY_MAX_READ_BYTES)} bytes`,
    );
  }
  const bytes = await readFile(path);
  let content: string;
  try {
    // Preserve a BOM in the returned content so re-encoding still describes
    // the exact bytes whose digest is recorded; renderers may omit it.
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch (error) {
    throw new Error("Agent memory browser reads require UTF-8 text", {
      cause: error,
    });
  }
  const after = await inspectStableFile(path, relativePath);
  await assertMemoryReadParents(rootDirectory, workspacePath, relativePath);
  if (
    before.contentDigest !== after.contentDigest ||
    before.modifiedAt !== after.modifiedAt ||
    before.bytes !== after.bytes
  ) {
    throw new Error("Agent memory file changed during browser read");
  }
  return Object.freeze({
    content,
    file: after,
    ownerParticipantId,
  });
}

function assertSameMaterialization(
  existing: AgentMemoryMaterializationReceipt,
  candidate: AgentMemoryMaterializationReceipt,
): AgentMemoryMaterializationReceipt {
  if (existing.schemaVersion === 1 || candidate.schemaVersion === 1) {
    throw new Error(
      "Legacy memory receipt cannot be revalidated as index-only; use a new RunAttempt",
    );
  }
  const identityFields = [
    "activationId",
    "agentDefinitionRevisionId",
    "computerHostId",
    "ownerParticipantId",
    "roomId",
    "runAttemptId",
  ] as const;
  if (
    identityFields.some((field) => existing[field] !== candidate[field]) ||
    existing.files[0].contentDigest !== candidate.files[0].contentDigest ||
    existing.files[0].bytes !== candidate.files[0].bytes ||
    JSON.stringify(existing.source ?? null) !==
      JSON.stringify(candidate.source ?? null) ||
    JSON.stringify(existing.memoryPolicyRef) !==
      JSON.stringify(candidate.memoryPolicyRef)
  ) {
    throw new Error(
      "RunAttempt attempted to materialize a different memory index or identity",
    );
  }
  return existing;
}

// Only the selected path's ancestors are checked, never unrelated notes. This
// is a host-access guard, not an OS sandbox against same-UID concurrent writers.
async function assertMemoryReadParents(
  rootDirectory: string,
  workspacePath: string,
  relativePath: string,
): Promise<void> {
  for (const path of [rootDirectory, workspacePath]) {
    assertPrivateDirectoryMetadata(
      await lstat(path),
      path,
      "Agent memory directory",
    );
  }
  let parent = workspacePath;
  for (const part of relativePath.split("/").slice(0, -1)) {
    parent = join(parent, part);
    assertOwnedDirectory(
      await lstat(parent),
      parent,
      "Agent memory read directory",
    );
  }
}

async function inspectNotesTree(
  notesPath: string,
): Promise<AgentMemoryMaterializedFile[]> {
  const files: AgentMemoryMaterializedFile[] = [];
  await walkNotesDirectory(notesPath, notesPath, files);
  files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  return files;
}

async function walkNotesDirectory(
  root: string,
  directory: string,
  files: AgentMemoryMaterializedFile[],
): Promise<void> {
  const before = await lstat(directory);
  assertOwnedDirectory(before, directory, "Agent memory notes directory");
  const entries = [];
  const iterator = await opendir(directory);
  for await (const entry of iterator) entries.push(entry);
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Agent memory note cannot be a symbolic link: ${path}`);
    }
    if (entry.isDirectory()) {
      await walkNotesDirectory(root, path, files);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Agent memory note must be a regular file: ${path}`);
    }
    if (files.length >= MAX_NOTE_FILES) {
      throw new Error(
        `Agent memory notes exceed ${String(MAX_NOTE_FILES)} files`,
      );
    }
    const noteRelativePath = relative(root, path).split(sep).join("/");
    files.push(await inspectStableFile(path, `notes/${noteRelativePath}`));
  }
  const after = await lstat(directory);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mtimeMs !== after.mtimeMs
  ) {
    throw new Error(
      `Agent memory notes changed during materialization: ${directory}`,
    );
  }
}

async function inspectStableFile(
  path: string,
  relativePath: string,
): Promise<AgentMemoryMaterializedFile> {
  const before = await lstat(path);
  assertOwnedRegularFile(before, path, "Agent memory file");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const after = await lstat(path);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  ) {
    throw new Error(
      `Agent memory file changed during materialization: ${path}`,
    );
  }
  const bytes = Number(after.size);
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error(`Agent memory file size is invalid: ${path}`);
  }
  return Object.freeze({
    bytes,
    contentDigest: `sha256:${hash.digest("hex")}`,
    modifiedAt: new Date(after.mtimeMs).toISOString(),
    relativePath,
  });
}

export function agentMemoryMaterializationReceiptPath(
  rootDirectory: string,
  runAttemptId: string,
): string {
  return join(
    requireAbsolute(rootDirectory),
    RECEIPT_DIRECTORY,
    `${createHash("sha256").update(requiredText(runAttemptId, "runAttemptId")).digest("hex")}.json`,
  );
}

const receiptFilePath = agentMemoryMaterializationReceiptPath;

function digestJson(value: unknown): `sha256:${string}` {
  return digestText(JSON.stringify(value));
}

function digestText(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function requireAbsolute(path: string): string {
  if (!isAbsolute(path)) throw new Error("Agent memory root must be absolute");
  return resolve(path);
}

function assertPathInside(parent: string, child: string): void {
  const offset = relative(resolve(parent), resolve(child));
  if (
    offset === "" ||
    offset === ".." ||
    offset.startsWith(`..${sep}`) ||
    isAbsolute(offset)
  ) {
    throw new Error("Agent memory materialization path escapes its owner root");
  }
}

async function ensurePrivateDirectory(
  path: string,
  label: string,
): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  assertPrivateDirectoryMetadata(await lstat(path), path, label);
}

function assertPrivateDirectoryMetadata(
  metadata: Awaited<ReturnType<typeof lstat>>,
  path: string,
  label: string,
): void {
  assertOwnedDirectory(metadata, path, label);
  if ((Number(metadata.mode) & 0o077) !== 0) {
    throw new Error(`${label} is not private: ${path}`);
  }
}

function assertOwnedDirectory(
  metadata: Awaited<ReturnType<typeof lstat>>,
  path: string,
  label: string,
): void {
  const currentUid = process.getuid?.();
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (currentUid !== undefined && metadata.uid !== currentUid)
  ) {
    throw new Error(`${label} is not an owner-controlled directory: ${path}`);
  }
}

function assertOwnedRegularFile(
  metadata: Awaited<ReturnType<typeof lstat>>,
  path: string,
  label: string,
): void {
  const currentUid = process.getuid?.();
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    (currentUid !== undefined && metadata.uid !== currentUid)
  ) {
    throw new Error(
      `${label} is not an owner-controlled regular file: ${path}`,
    );
  }
}

function assertPrivateRegularFileMetadata(
  metadata: Awaited<ReturnType<typeof lstat>>,
  path: string,
  label: string,
): void {
  assertOwnedRegularFile(metadata, path, label);
  if ((Number(metadata.mode) & 0o077) !== 0) {
    throw new Error(`${label} is not private: ${path}`);
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
    throw new Error("Agent memory materialization clock is invalid");
  }
  return value;
}

function requiredText(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.includes("\0")
  ) {
    throw new Error(`${name} must be a non-empty safe string`);
  }
  return value;
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
