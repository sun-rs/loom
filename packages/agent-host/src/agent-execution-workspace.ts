import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { lstat, mkdir, open, rename } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

/**
 * Raft Computer 1.0.18 main.js:765082/765324 uses a stable per-Agent
 * agentDataDir as workingDirectory. RAH glue uses an opaque participant key
 * under a dedicated execution root, separate from the private memory owner.
 * Upstream bundle SHA-256:
 * 20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e.
 */
export function agentExecutionWorkspacePath(
  rootDirectory: string,
  participantId: string,
): string {
  if (!isAbsolute(rootDirectory))
    throw new Error("Agent execution root must be absolute");
  return join(resolve(rootDirectory), opaqueId(participantId));
}

export async function prepareAgentExecutionWorkspace(input: {
  rootDirectory: string;
  participantId: string;
}): Promise<Readonly<{ cwd: string }>> {
  const cwd = agentExecutionWorkspacePath(
    input.rootDirectory,
    input.participantId,
  );
  await ensurePrivateDirectory(resolve(input.rootDirectory));
  assertAgentExecutionWorkspaceAvailable(
    input.rootDirectory,
    input.participantId,
  );
  await ensurePrivateDirectory(cwd);
  return Object.freeze({ cwd });
}

/**
 * Caller owns the per-Agent reset fence, including exclusion of prepare/launch.
 * Like memory quarantine, commit retains the renamed directory as recovery
 * evidence; it never recursively deletes user files. Repeating the same
 * operation before recreation resumes its quarantine. A new active directory
 * together with the old quarantine is an explicit conflict, never overwritten.
 */
export async function quarantineAgentExecutionWorkspace(input: {
  rootDirectory: string;
  participantId: string;
  operationId: string;
}): Promise<Readonly<{ commit(): void; rollback(): Promise<void> }>> {
  const cwd = agentExecutionWorkspacePath(
    input.rootDirectory,
    input.participantId,
  );
  const operationKey = opaqueId(input.operationId);
  await ensurePrivateDirectory(resolve(input.rootDirectory));
  const quarantineRoot = join(resolve(input.rootDirectory), ".quarantine");
  await ensurePrivateDirectory(quarantineRoot);
  const quarantinePath = join(
    quarantineRoot,
    `${basename(cwd)}.${operationKey}`,
  );
  const receiptPath = join(
    quarantineRoot,
    `${opaqueId(input.participantId)}.reset.json`,
  );
  let receipt = readResetReceipt(receiptPath);
  if (
    receipt?.status === "pending" &&
    receipt.operationId !== input.operationId
  )
    throw new Error("Agent execution has another pending reset");
  if (
    receipt?.operationId === input.operationId &&
    receipt.status === "committed"
  )
    return Object.freeze({ commit() {}, async rollback() {} });
  if (
    receipt?.operationId !== input.operationId ||
    receipt.status !== "pending"
  ) {
    receipt = {
      participantId: input.participantId,
      operationId: input.operationId,
      status: "pending",
    };
    writeResetReceipt(receiptPath, receipt);
  }
  if (receipt === undefined)
    throw new Error("Execution reset receipt was not established");
  let leaseReceipt: ResetReceipt = receipt;
  const sourceExists = await privateDirectoryExists(cwd);
  const quarantineExists = await privateDirectoryExists(quarantinePath);
  if (sourceExists && quarantineExists)
    throw new Error(
      "Agent execution reset found both active and quarantined operation state",
    );
  if (sourceExists && !leaseReceipt.restoring) {
    await rename(cwd, quarantinePath);
    await syncDirectory(dirname(cwd));
    await syncDirectory(quarantineRoot);
  }
  const moved = sourceExists || quarantineExists;
  let active = true;
  return Object.freeze({
    commit() {
      if (!active) return;
      const latest = readResetReceipt(receiptPath);
      if (latest?.operationId !== input.operationId)
        throw new Error("Execution reset lease was superseded");
      if (latest.status !== "pending") {
        active = false;
        return;
      }
      writeResetReceipt(receiptPath, { ...leaseReceipt, status: "committed" });
      active = false;
    },
    async rollback() {
      if (!active) return;
      const latest = readResetReceipt(receiptPath);
      if (latest?.operationId !== input.operationId)
        throw new Error("Execution reset lease was superseded");
      if (latest.status !== "pending") {
        active = false;
        return;
      }
      if (!moved) {
        writeResetReceipt(receiptPath, {
          ...leaseReceipt,
          status: "rolled_back",
        });
        active = false;
        return;
      }
      if (
        leaseReceipt.restoring &&
        (await privateDirectoryExists(cwd)) &&
        !(await privateDirectoryExists(quarantinePath))
      ) {
        writeResetReceipt(receiptPath, {
          ...leaseReceipt,
          status: "rolled_back",
        });
        active = false;
        return;
      }
      await assertNoSymlinkAncestors(cwd);
      await assertNoSymlinkAncestors(quarantinePath);
      if (await privateDirectoryExists(cwd))
        throw new Error(
          "Agent execution rollback would overwrite an active workspace",
        );
      if (!(await privateDirectoryExists(quarantinePath)))
        throw new Error(
          "Agent execution rollback lost its quarantined workspace",
        );
      leaseReceipt = { ...leaseReceipt, restoring: true };
      writeResetReceipt(receiptPath, leaseReceipt);
      await rename(quarantinePath, cwd);
      await syncDirectory(dirname(cwd));
      await syncDirectory(quarantineRoot);
      writeResetReceipt(receiptPath, {
        ...leaseReceipt,
        status: "rolled_back",
      });
      active = false;
    },
  });
}

function opaqueId(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > 512 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error("Agent execution identity must be a non-empty safe string");
  }
  return createHash("sha256").update(value).digest("hex");
}

async function assertNoSymlinkAncestors(path: string): Promise<void> {
  const parent = dirname(path);
  if (parent !== path) await assertNoSymlinkAncestors(parent);
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink())
      throw new Error(`Agent execution path contains a symlink: ${path}`);
    if (!stat.isDirectory())
      throw new Error(`Agent execution path is not a directory: ${path}`);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await assertNoSymlinkAncestors(path);
  await mkdir(path, { recursive: true, mode: 0o700 });
  await privateDirectoryExists(path);
}

async function privateDirectoryExists(path: string): Promise<boolean> {
  await assertNoSymlinkAncestors(path);
  try {
    const stat = await lstat(path);
    const uid = process.getuid?.();
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (uid !== undefined && stat.uid !== uid) ||
      (stat.mode & 0o077) !== 0
    ) {
      throw new Error(
        `Agent execution directory is not private and owner-controlled: ${path}`,
      );
    }
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

type ResetReceipt = {
  participantId: string;
  operationId: string;
  status: "pending" | "committed" | "rolled_back";
  restoring?: boolean;
};
export function pendingAgentExecutionWorkspaceQuarantines(
  rootDirectory: string,
): readonly Readonly<{ participantId: string; operationId: string }>[] {
  const root = join(resolve(rootDirectory), ".quarantine");
  assertSyncDirectory(root);
  let files: string[];
  try {
    files = readdirSync(root);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const pending: ResetReceipt[] = [];
  for (const file of files) {
    if (!file.endsWith(".reset.json")) continue;
    const receipt = readResetReceipt(join(root, file));
    if (receipt?.status === "pending") pending.push(receipt);
  }
  return pending;
}
export function assertAgentExecutionWorkspaceAvailable(
  rootDirectory: string,
  participantId: string,
): void {
  const receipt = readResetReceipt(
    join(
      resolve(rootDirectory),
      ".quarantine",
      `${opaqueId(participantId)}.reset.json`,
    ),
  );
  if (receipt?.status === "pending")
    throw new Error("Agent execution workspace has a pending reset");
}
function assertSyncDirectory(path: string): void {
  const parent = dirname(path);
  if (parent !== path) assertSyncDirectory(parent);
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error(
        "Agent execution receipt ancestor is a symlink or not a directory",
      );
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}
function readResetReceipt(path: string): ResetReceipt | undefined {
  assertSyncDirectory(dirname(path));
  try {
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid !== undefined && stat.uid !== process.getuid())
    )
      throw new Error("Unsafe Agent execution reset receipt");
    const raw = JSON.parse(readFileSync(path, "utf8")) as ResetReceipt;
    if (
      !["pending", "committed", "rolled_back"].includes(raw.status) ||
      typeof raw.operationId !== "string" ||
      (raw.restoring !== undefined && typeof raw.restoring !== "boolean") ||
      basename(path) !== `${opaqueId(raw.participantId)}.reset.json`
    )
      throw new Error("Invalid Agent execution reset receipt");
    opaqueId(raw.operationId);
    return raw;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}
function writeResetReceipt(path: string, receipt: ResetReceipt): void {
  assertSyncDirectory(dirname(path));
  readResetReceipt(path);
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(receipt));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temporary, path);
    const dir = openSync(dirname(path), "r");
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  } finally {
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
}

export function finalizeAgentExecutionWorkspaceQuarantine(
  rootDirectory: string,
  participantId: string,
  operationId: string,
  options: Readonly<{ ignoreNonMatching?: boolean }> = {},
): void {
  const path = join(
    resolve(rootDirectory),
    ".quarantine",
    `${opaqueId(participantId)}.reset.json`,
  );
  const receipt = readResetReceipt(path);
  if (receipt === undefined) return;
  if (receipt.operationId !== operationId) {
    // Only a caller with authoritative completed-operation evidence may use
    // this for historical replay; never mutate the newer operation's receipt.
    if (options.ignoreNonMatching) return;
    throw new Error("Execution reset receipt belongs to another operation");
  }
  if (receipt.status === "rolled_back")
    throw new Error("Cannot commit a rolled-back execution reset");
  if (receipt.status !== "committed")
    writeResetReceipt(path, { ...receipt, status: "committed" });
}
