import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const LEGACY_DEFAULT_DIRECTORY = [
  "Library",
  "Application Support",
  "RAH OS",
] as const;
const MIGRATION_STAGING_NAME = ".local-core-migration-v1";
const MIGRATION_RECEIPT_NAME = ".local-core-data-v1.json";

export type RahDataHomeOptions = Readonly<{
  environment?: NodeJS.ProcessEnv;
  userHomeDirectory?: string;
}>;

/** Stable user-data identity that does not depend on the current app name. */
export function resolveRahDataHome(options: RahDataHomeOptions = {}): string {
  const environment = options.environment ?? process.env;
  const userHomeDirectory = absolutePath(
    options.userHomeDirectory ?? homedir(),
    "userHomeDirectory",
  );
  const canonical = optionalAbsolute(
    environment.RAH_DATA_HOME,
    "RAH_DATA_HOME",
  );
  const legacyOverride = optionalAbsolute(
    environment.RAH_OS_HOME,
    "RAH_OS_HOME",
  );
  if (
    canonical !== undefined &&
    legacyOverride !== undefined &&
    canonical !== legacyOverride
  ) {
    throw new Error(
      `conflicting RAH data roots: RAH_DATA_HOME=${canonical} and RAH_OS_HOME=${legacyOverride}`,
    );
  }
  return canonical ?? legacyOverride ?? join(userHomeDirectory, ".rah");
}

/**
 * Moves the former macOS default into ~/.rah on the first unconfigured start.
 * Existing legacy RAH children are merged only after a collision preflight.
 * A fixed staging child makes an interrupted merge resumable.
 */
export async function prepareRahDataHome(
  options: RahDataHomeOptions = {},
): Promise<string> {
  const environment = options.environment ?? process.env;
  const userHomeDirectory = absolutePath(
    options.userHomeDirectory ?? homedir(),
    "userHomeDirectory",
  );
  const dataRoot = resolveRahDataHome({ environment, userHomeDirectory });
  if (hasExplicitRoot(environment)) return dataRoot;

  const legacyRoot = join(userHomeDirectory, ...LEGACY_DEFAULT_DIRECTORY);
  const legacyEvidence = await optionalLstat(legacyRoot);
  const targetEvidence = await optionalLstat(dataRoot);
  if (legacyEvidence === undefined) {
    if (targetEvidence !== undefined) {
      await ensurePrivateDirectory(dataRoot);
      const staged = join(dataRoot, MIGRATION_STAGING_NAME);
      if ((await optionalLstat(staged)) !== undefined) {
        await preflightMerge(staged, dataRoot);
        await mergeDirectory(staged, dataRoot);
        await rmdir(staged);
        await writeMigrationReceipt(dataRoot, legacyRoot);
      }
    }
    return dataRoot;
  }
  requireDirectory(legacyEvidence, legacyRoot);

  if (targetEvidence === undefined) {
    await assertSafeSourceTree(legacyRoot, legacyEvidence);
    await mkdir(dirname(dataRoot), { recursive: true });
    await rename(legacyRoot, dataRoot);
    await ensurePrivateDirectory(dataRoot);
    await writeMigrationReceipt(dataRoot, legacyRoot);
    return dataRoot;
  }
  requireDirectory(targetEvidence, dataRoot);
  await ensurePrivateDirectory(dataRoot);

  const stagingRoot = join(dataRoot, MIGRATION_STAGING_NAME);
  const stagingEvidence = await optionalLstat(stagingRoot);
  if (stagingEvidence !== undefined) {
    throw new Error(
      `RAH data migration conflict: both legacy source and recovery staging exist (${legacyRoot}, ${stagingRoot})`,
    );
  }
  await preflightMerge(legacyRoot, dataRoot);
  await rename(legacyRoot, stagingRoot);
  await mergeDirectory(stagingRoot, dataRoot);
  await rmdir(stagingRoot);
  await writeMigrationReceipt(dataRoot, legacyRoot);
  return dataRoot;
}

function hasExplicitRoot(environment: NodeJS.ProcessEnv): boolean {
  return Boolean(
    environment.RAH_DATA_HOME?.trim() || environment.RAH_OS_HOME?.trim(),
  );
}

async function preflightMerge(source: string, target: string): Promise<void> {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    const sourceEvidence = await lstat(sourcePath);
    if (sourceEvidence.isSymbolicLink()) {
      throw new Error(
        `RAH data migration conflict: symbolic link is not accepted (${sourcePath})`,
      );
    }
    const targetEntry = await optionalLstat(targetPath);
    if (targetEntry === undefined) {
      await assertSafeSourceTree(sourcePath, sourceEvidence);
      continue;
    }
    if (targetEntry.isSymbolicLink()) {
      throw new Error(
        `RAH data migration conflict: symbolic link is not accepted (${targetPath})`,
      );
    }
    if (sourceEvidence.isDirectory() && targetEntry.isDirectory()) {
      await preflightMerge(sourcePath, targetPath);
      continue;
    }
    throw new Error(
      `RAH data migration conflict: both roots contain ${targetPath}`,
    );
  }
}

async function assertSafeSourceTree(
  path: string,
  evidence: Awaited<ReturnType<typeof lstat>>,
): Promise<void> {
  if (evidence.isSymbolicLink()) {
    throw new Error(
      `RAH data migration conflict: symbolic link is not accepted (${path})`,
    );
  }
  if (evidence.isFile()) return;
  if (!evidence.isDirectory()) {
    throw new Error(
      `RAH data migration conflict: unsupported filesystem entry (${path})`,
    );
  }
  for (const entry of await readdir(path)) {
    const child = join(path, entry);
    await assertSafeSourceTree(child, await lstat(child));
  }
}

async function mergeDirectory(source: string, target: string): Promise<void> {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    const targetEntry = await optionalLstat(targetPath);
    if (targetEntry === undefined) {
      await rename(sourcePath, targetPath);
      continue;
    }
    if (!entry.isDirectory() || !targetEntry.isDirectory()) {
      throw new Error(
        `RAH data migration conflict while resuming: ${targetPath}`,
      );
    }
    await mergeDirectory(sourcePath, targetPath);
    await rmdir(sourcePath);
  }
}

async function writeMigrationReceipt(
  dataRoot: string,
  legacyRoot: string,
): Promise<void> {
  const target = join(dataRoot, MIGRATION_RECEIPT_NAME);
  const temporary = join(
    dataRoot,
    `.${basename(target)}.${String(process.pid)}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(
      temporary,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          migratedFrom: legacyRoot,
          migratedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      { flag: "wx", mode: 0o600 },
    );
    await rename(temporary, target);
    await chmod(target, 0o600);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  const evidence = await lstat(path);
  requireDirectory(evidence, path);
  if (process.getuid?.() !== undefined && evidence.uid !== process.getuid?.()) {
    throw new Error(`RAH data root is not owned by the current user: ${path}`);
  }
  await chmod(path, 0o700);
}

function requireDirectory(
  evidence: Awaited<ReturnType<typeof lstat>>,
  path: string,
): void {
  if (!evidence.isDirectory() || evidence.isSymbolicLink()) {
    throw new Error(`RAH data root must be a real directory: ${path}`);
  }
}

async function optionalLstat(
  path: string,
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function optionalAbsolute(
  value: string | undefined,
  name: string,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? absolutePath(trimmed, name) : undefined;
}

function absolutePath(value: string, name: string): string {
  if (!isAbsolute(value) || value.includes("\0")) {
    throw new Error(`${name} must be an absolute path`);
  }
  return resolve(value);
}
