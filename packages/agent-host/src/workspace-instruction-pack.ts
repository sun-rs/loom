import { createHash, randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  isWorkspaceInstructionPackPath,
  WORKSPACE_INSTRUCTION_PACK_MAX_BYTES,
  WORKSPACE_INSTRUCTION_PACK_MAX_FILE_BYTES,
  WORKSPACE_INSTRUCTION_PACK_MAX_FILES,
  WORKSPACE_INSTRUCTION_PACK_PROTOCOL_VERSION,
  WorkspaceInstructionPackSchema,
  type WorkspaceInstructionPack,
} from "@rah-os/protocol";

const MARKER_PATH = ".rah/workspace-instruction-pack.json";
const MAX_MARKER_BYTES = 128 * 1_024;
const SHA256 = /^[0-9a-f]{64}$/u;

export type WorkspaceInstructionPackSourceFile = Readonly<{
  content: string;
  relativePath: string;
}>;

export type WorkspaceInstructionPackReceiptFile = Readonly<{
  relativePath: string;
  sha256: string;
  size: number;
}>;

export type WorkspaceInstructionPackReceipt = Readonly<{
  files: readonly WorkspaceInstructionPackReceiptFile[];
  packId: string;
  protocolVersion: 1;
}>;

export type WorkspaceInstructionPackInstallResult = Readonly<{
  files: readonly WorkspaceInstructionPackReceiptFile[];
  kind: "installed" | "unchanged";
  packId: string;
}>;

export type WorkspaceInstructionPackInstallRuntime = Readonly<{
  afterBackup?: () => Promise<void>;
}>;

/**
 * Builds the exact content-addressed protocol artifact. The canonicalization
 * shape follows the authorized Raft Computer 1.0.18 Workspace Pack evidence,
 * while the marker namespace and ownership contract belong to RAH OS.
 */
export function buildWorkspaceInstructionPack(
  sourceFiles: readonly WorkspaceInstructionPackSourceFile[],
): WorkspaceInstructionPack {
  if (!Array.isArray(sourceFiles)) {
    throw new Error("Workspace instruction pack source must be an array");
  }
  const files = sourceFiles.map((source) => {
    if (
      typeof source !== "object" ||
      source === null ||
      Object.keys(source).sort().join(",") !== "content,relativePath" ||
      typeof source.content !== "string" ||
      typeof source.relativePath !== "string"
    ) {
      throw new Error("Workspace instruction pack source file is invalid");
    }
    const size = Buffer.byteLength(source.content, "utf8");
    return {
      content: source.content,
      relativePath: source.relativePath,
      sha256: sha256(source.content),
      size,
    };
  });
  const packId = sha256(canonicalFiles(files));
  const parsed = WorkspaceInstructionPackSchema.parse({
    files,
    packId,
    protocolVersion: WORKSPACE_INSTRUCTION_PACK_PROTOCOL_VERSION,
  });
  return freezePack(parsed);
}

/** Installs a validated pack as one rollback-capable managed file set. */
export async function ensureWorkspaceInstructionPack(
  workspacePath: string,
  input: WorkspaceInstructionPack,
  runtime: WorkspaceInstructionPackInstallRuntime = {},
): Promise<WorkspaceInstructionPackInstallResult> {
  const workspace = absolutePath(workspacePath, "workspacePath");
  await assertWorkspaceRoot(workspace);
  const pack = validatePack(input);
  const previousMarker = await readMarker(workspace);
  const installed = await verifyWithMarker(workspace, previousMarker);
  if (installed?.packId === pack.packId) {
    return Object.freeze({
      files: installed.files,
      kind: "unchanged",
      packId: installed.packId,
    });
  }
  await installPack(workspace, pack, previousMarker, runtime);
  const verified = await verifyWorkspaceInstructionPack(workspace);
  if (verified?.packId !== pack.packId) {
    throw new Error(
      "Workspace instruction pack installation failed readback verification",
    );
  }
  return Object.freeze({
    files: verified.files,
    kind: "installed",
    packId: verified.packId,
  });
}

export async function verifyWorkspaceInstructionPack(
  workspacePath: string,
): Promise<WorkspaceInstructionPackReceipt | null> {
  const workspace = absolutePath(workspacePath, "workspacePath");
  await assertWorkspaceRoot(workspace);
  const marker = await readMarker(workspace);
  return await verifyWithMarker(workspace, marker);
}

function validatePack(
  input: WorkspaceInstructionPack,
): WorkspaceInstructionPack {
  const pack = WorkspaceInstructionPackSchema.parse(input);
  for (const file of pack.files) {
    if (sha256(file.content) !== file.sha256) {
      throw new Error(
        `Workspace instruction pack file hash mismatch: ${file.relativePath}`,
      );
    }
  }
  if (sha256(canonicalFiles(pack.files)) !== pack.packId) {
    throw new Error(
      "Workspace instruction pack content hash does not match packId",
    );
  }
  return freezePack(pack);
}

function canonicalFiles(
  files: readonly Readonly<{ content: string; relativePath: string }>[],
): string {
  return JSON.stringify({
    files: [...files]
      .map(({ content, relativePath }) => ({ content, relativePath }))
      .sort((left, right) =>
        comparePaths(left.relativePath, right.relativePath),
      ),
    protocolVersion: WORKSPACE_INSTRUCTION_PACK_PROTOCOL_VERSION,
  });
}

async function installPack(
  workspace: string,
  pack: WorkspaceInstructionPack,
  previousMarker: WorkspaceInstructionPackReceipt | null,
  runtime: WorkspaceInstructionPackInstallRuntime,
): Promise<void> {
  const transactionRoot = await mkdtemp(
    join(workspace, ".rah-workspace-pack-"),
  );
  await assertPrivateDirectory(transactionRoot, "transaction directory");
  const nextRoot = join(transactionRoot, "next");
  const backupRoot = join(transactionRoot, "backup");
  const markerPath = targetPath(workspace, MARKER_PATH);
  const backupMarkerPath = targetPath(backupRoot, MARKER_PATH);
  const managedPaths = [
    ...new Set([
      ...(previousMarker?.files.map((file) => file.relativePath) ?? []),
      ...pack.files.map((file) => file.relativePath),
    ]),
  ].sort(comparePaths);
  const installedNewPaths: string[] = [];
  const backedUpPaths: string[] = [];
  let markerBackedUp = false;
  let temporaryMarkerPath: string | undefined;
  let committed = false;
  try {
    for (const file of pack.files) {
      const stagedPath = targetPath(nextRoot, file.relativePath);
      await mkdir(dirname(stagedPath), { mode: 0o700, recursive: true });
      await writeFile(stagedPath, file.content, { flag: "wx", mode: 0o600 });
      const staged = await readFile(stagedPath);
      if (staged.byteLength !== file.size || sha256(staged) !== file.sha256) {
        throw new Error(
          `Workspace instruction pack staged readback mismatch: ${file.relativePath}`,
        );
      }
    }
    await assertWorkspacePathIsSafe(workspace, MARKER_PATH);
    for (const relativePath of managedPaths) {
      await assertWorkspacePathIsSafe(workspace, relativePath);
    }
    markerBackedUp = await copyIfPresent(markerPath, backupMarkerPath);
    for (const relativePath of managedPaths) {
      const source = targetPath(workspace, relativePath);
      const backup = targetPath(backupRoot, relativePath);
      if (await moveIfPresent(source, backup)) {
        backedUpPaths.push(relativePath);
      }
    }
    await runtime.afterBackup?.();
    for (const file of pack.files) {
      const staged = targetPath(nextRoot, file.relativePath);
      const target = targetPath(workspace, file.relativePath);
      await mkdir(dirname(target), { mode: 0o755, recursive: true });
      await rename(staged, target);
      installedNewPaths.push(file.relativePath);
    }
    const marker = receiptFor(pack);
    await assertWorkspacePathIsSafe(workspace, MARKER_PATH);
    await mkdir(dirname(markerPath), { mode: 0o700, recursive: true });
    await assertPrivateDirectory(dirname(markerPath), "marker directory");
    temporaryMarkerPath = `${markerPath}.${String(process.pid)}-${randomUUID()}.tmp`;
    await writeFile(temporaryMarkerPath, `${JSON.stringify(marker)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryMarkerPath, markerPath);
    temporaryMarkerPath = undefined;
    committed = true;
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    await rollbackStep(rollbackErrors, async () => {
      if (temporaryMarkerPath !== undefined) {
        await rm(temporaryMarkerPath, { force: true });
      }
    });
    await rollbackStep(
      rollbackErrors,
      async () => await rm(markerPath, { force: true }),
    );
    for (const relativePath of installedNewPaths.reverse()) {
      await rollbackStep(
        rollbackErrors,
        async () =>
          await rm(targetPath(workspace, relativePath), { force: true }),
      );
    }
    for (const relativePath of backedUpPaths.reverse()) {
      await rollbackStep(rollbackErrors, async () => {
        const backup = targetPath(backupRoot, relativePath);
        const target = targetPath(workspace, relativePath);
        await mkdir(dirname(target), { mode: 0o755, recursive: true });
        await rename(backup, target);
      });
    }
    if (markerBackedUp) {
      await rollbackStep(rollbackErrors, async () => {
        await mkdir(dirname(markerPath), { mode: 0o700, recursive: true });
        await rename(backupMarkerPath, markerPath);
      });
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Workspace instruction pack installation and rollback both failed",
      );
    }
    throw error;
  } finally {
    try {
      await rm(transactionRoot, { force: true, recursive: true });
    } catch (error) {
      if (committed) throw error;
    }
  }
}

async function verifyWithMarker(
  workspace: string,
  marker: WorkspaceInstructionPackReceipt | null,
): Promise<WorkspaceInstructionPackReceipt | null> {
  if (marker === null) return null;
  const files: WorkspaceInstructionPackReceiptFile[] = [];
  const contentFiles: WorkspaceInstructionPackSourceFile[] = [];
  for (const expected of marker.files) {
    try {
      await assertWorkspacePathIsSafe(workspace, expected.relativePath);
      const path = targetPath(workspace, expected.relativePath);
      const metadata = await lstat(path);
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        metadata.size !== expected.size ||
        metadata.size > WORKSPACE_INSTRUCTION_PACK_MAX_FILE_BYTES
      ) {
        return null;
      }
      const bytes = await readFile(path);
      if (sha256(bytes) !== expected.sha256) return null;
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return null;
      }
      files.push(Object.freeze({ ...expected }));
      contentFiles.push(
        Object.freeze({ content, relativePath: expected.relativePath }),
      );
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }
  }
  if (sha256(canonicalFiles(contentFiles)) !== marker.packId) return null;
  return Object.freeze({
    files: Object.freeze(files),
    packId: marker.packId,
    protocolVersion: 1,
  });
}

async function readMarker(
  workspace: string,
): Promise<WorkspaceInstructionPackReceipt | null> {
  await assertWorkspacePathIsSafe(workspace, MARKER_PATH);
  const path = targetPath(workspace, MARKER_PATH);
  let metadata: Stats;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size <= 0 ||
    metadata.size > MAX_MARKER_BYTES ||
    (metadata.mode & 0o077) !== 0 ||
    !ownedByCurrentUser(metadata)
  ) {
    throw new Error(
      "Workspace instruction pack marker must be an owner-private regular file",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw new Error("Workspace instruction pack marker must be valid JSON");
  }
  return parseReceipt(parsed);
}

function parseReceipt(value: unknown): WorkspaceInstructionPackReceipt {
  const marker = exactRecord(
    value,
    ["files", "packId", "protocolVersion"],
    "marker",
  );
  if (
    marker.protocolVersion !== WORKSPACE_INSTRUCTION_PACK_PROTOCOL_VERSION ||
    typeof marker.packId !== "string" ||
    !SHA256.test(marker.packId) ||
    !Array.isArray(marker.files) ||
    marker.files.length === 0 ||
    marker.files.length > WORKSPACE_INSTRUCTION_PACK_MAX_FILES
  ) {
    throw new Error("Workspace instruction pack marker shape is invalid");
  }
  const paths = new Set<string>();
  const files: WorkspaceInstructionPackReceiptFile[] = [];
  let totalBytes = 0;
  for (const [index, value_] of marker.files.entries()) {
    const file = exactRecord(
      value_,
      ["relativePath", "sha256", "size"],
      `marker.files[${String(index)}]`,
    );
    if (
      typeof file.relativePath !== "string" ||
      !isWorkspaceInstructionPackPath(file.relativePath) ||
      paths.has(file.relativePath) ||
      typeof file.sha256 !== "string" ||
      !SHA256.test(file.sha256) ||
      !Number.isSafeInteger(file.size) ||
      (file.size as number) <= 0 ||
      (file.size as number) > WORKSPACE_INSTRUCTION_PACK_MAX_FILE_BYTES
    ) {
      throw new Error("Workspace instruction pack marker file is invalid");
    }
    paths.add(file.relativePath);
    totalBytes += file.size as number;
    files.push(
      Object.freeze({
        relativePath: file.relativePath,
        sha256: file.sha256,
        size: file.size as number,
      }),
    );
  }
  if (
    !paths.has("AGENTS.md") ||
    !paths.has("CLAUDE.md") ||
    totalBytes > WORKSPACE_INSTRUCTION_PACK_MAX_BYTES
  ) {
    throw new Error("Workspace instruction pack marker file set is invalid");
  }
  return Object.freeze({
    files: Object.freeze(
      files.sort((left, right) =>
        comparePaths(left.relativePath, right.relativePath),
      ),
    ),
    packId: marker.packId,
    protocolVersion: 1,
  });
}

function receiptFor(
  pack: WorkspaceInstructionPack,
): WorkspaceInstructionPackReceipt {
  return Object.freeze({
    files: Object.freeze(
      pack.files
        .map((file) =>
          Object.freeze({
            relativePath: file.relativePath,
            sha256: file.sha256,
            size: file.size,
          }),
        )
        .sort((left, right) =>
          comparePaths(left.relativePath, right.relativePath),
        ),
    ),
    packId: pack.packId,
    protocolVersion: 1,
  });
}

async function assertWorkspaceRoot(workspace: string): Promise<void> {
  const metadata = await lstat(workspace);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o022) !== 0 ||
    !ownedByCurrentUser(metadata)
  ) {
    throw new Error("Workspace instruction pack root must be owner-controlled");
  }
}

async function assertWorkspacePathIsSafe(
  workspace: string,
  relativePath: string,
): Promise<void> {
  await assertWorkspaceRoot(workspace);
  const segments = relativePath.split("/");
  let current = workspace;
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    const metadata = await tryLstat(current);
    if (metadata === null) return;
    if (metadata.isSymbolicLink()) {
      throw new Error(
        `Workspace instruction pack path crosses a symbolic link: ${relativePath}`,
      );
    }
    if (
      metadata.isDirectory() &&
      ((metadata.mode & 0o022) !== 0 || !ownedByCurrentUser(metadata))
    ) {
      throw new Error(
        `Workspace instruction pack path crosses a non-owner-controlled ancestor: ${relativePath}`,
      );
    }
    if (index < segments.length - 1 && !metadata.isDirectory()) {
      throw new Error(
        `Workspace instruction pack path has a non-directory ancestor: ${relativePath}`,
      );
    }
    if (
      index === segments.length - 1 &&
      !metadata.isDirectory() &&
      ((metadata.mode & 0o022) !== 0 || !ownedByCurrentUser(metadata))
    ) {
      throw new Error(
        `Workspace instruction pack managed path is not owner-controlled: ${relativePath}`,
      );
    }
  }
}

async function assertPrivateDirectory(
  path: string,
  name: string,
): Promise<void> {
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o077) !== 0 ||
    !ownedByCurrentUser(metadata)
  ) {
    throw new Error(`Workspace instruction pack ${name} is not private`);
  }
}

async function moveIfPresent(
  source: string,
  destination: string,
): Promise<boolean> {
  const metadata = await tryLstat(source);
  if (metadata === null) return false;
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(
      "Workspace instruction pack managed path is not a regular file",
    );
  }
  await mkdir(dirname(destination), { mode: 0o700, recursive: true });
  await rename(source, destination);
  return true;
}

async function copyIfPresent(
  source: string,
  destination: string,
): Promise<boolean> {
  const metadata = await tryLstat(source);
  if (metadata === null) return false;
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("Workspace instruction pack marker is not a regular file");
  }
  await mkdir(dirname(destination), { mode: 0o700, recursive: true });
  await copyFile(source, destination);
  return true;
}

async function tryLstat(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
}

async function rollbackStep(
  errors: unknown[],
  step: () => Promise<void>,
): Promise<void> {
  try {
    await step();
  } catch (error) {
    errors.push(error);
  }
}

function targetPath(root: string, relativePath: string): string {
  return join(root, ...relativePath.split("/"));
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  name: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Workspace instruction pack ${name} shape is invalid`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`Workspace instruction pack ${name} shape is invalid`);
  }
  return record;
}

function freezePack(pack: WorkspaceInstructionPack): WorkspaceInstructionPack {
  return Object.freeze({
    files: Object.freeze(pack.files.map((file) => Object.freeze({ ...file }))),
    packId: pack.packId,
    protocolVersion: 1,
  }) as WorkspaceInstructionPack;
}

function absolutePath(value: string, name: string): string {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    value.includes("\0") ||
    value.length > 4_096
  ) {
    throw new Error(`${name} must be an absolute path`);
  }
  return resolve(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function ownedByCurrentUser(metadata: Stats): boolean {
  return (
    typeof process.getuid !== "function" || metadata.uid === process.getuid()
  );
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
