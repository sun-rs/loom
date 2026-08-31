import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  AgentMemoryProjectCatalogSchema,
  AgentMemoryRunSourceSchema,
  type AgentMemoryRunSource,
} from "@rah-os/protocol";

export const AGENT_MEMORY_PROJECT_CATALOG_FILE = ".project-bindings.json";
export const RAH_AGENT_MEMORY_SOURCE_FILE_ENV = "RAH_AGENT_MEMORY_SOURCE_FILE";
const MAX_CATALOG_BYTES = 262_144;

/** Explicit local operator metadata, never an inferred global project or ACL. */
export async function loadAgentMemoryRunSource(input: {
  rootDirectory: string;
  cwd: string;
}): Promise<AgentMemoryRunSource> {
  if (!isAbsolute(input.rootDirectory) || !isAbsolute(input.cwd))
    throw new Error("memory project paths must be absolute");
  const cwd = resolve(input.cwd);
  const realCwd = await realpath(cwd);
  if (!(await stat(realCwd)).isDirectory())
    throw new Error("memory source cwd must be a directory");
  const rootDirectory = resolve(input.rootDirectory);
  const rootMetadata = await lstat(rootDirectory);
  assertPrivate(rootMetadata, true);
  try {
    return await resolveCatalog(rootDirectory, cwd, realCwd);
  } catch (error) {
    throw new CatalogUnavailableError(cwd, realCwd, error);
  }
}

/** Optional relevance metadata must not become an Agent availability gate. */
export async function prepareAgentMemoryRunSource(input: {
  rootDirectory: string;
  cwd: string;
}): Promise<AgentMemoryRunSource> {
  try {
    return await loadAgentMemoryRunSource(input);
  } catch (error) {
    // Invalid execution cwd or unsafe memory root still fail closed above.
    if (!(error instanceof CatalogUnavailableError)) throw error;
    return AgentMemoryRunSourceSchema.parse({
      cwd: error.cwd,
      realCwd: error.realCwd,
      resolution: "unavailable",
      reason: "invalid_or_unavailable_catalog",
    });
  }
}

class CatalogUnavailableError extends Error {
  readonly cwd: string;
  readonly realCwd: string;
  constructor(cwd: string, realCwd: string, cause: unknown) {
    super(
      cause instanceof Error ? cause.message : "invalid memory project catalog",
      { cause },
    );
    this.cwd = cwd;
    this.realCwd = realCwd;
  }
}

async function resolveCatalog(
  rootDirectory: string,
  cwd: string,
  realCwd: string,
): Promise<AgentMemoryRunSource> {
  const path = join(rootDirectory, AGENT_MEMORY_PROJECT_CATALOG_FILE);
  const bytes = await readPrivateCatalog(path);
  if (bytes === null)
    return AgentMemoryRunSourceSchema.parse({
      cwd,
      realCwd,
      resolution: "unconfigured",
    });
  let decoded: unknown;
  try {
    decoded = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch (error) {
    throw new Error("Agent memory project catalog must be UTF-8 JSON", {
      cause: error,
    });
  }
  const catalog = AgentMemoryProjectCatalogSchema.parse(decoded);
  const catalogDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const physicalRoots = new Map<string, (typeof catalog.projects)[number]>();
  for (const project of catalog.projects) {
    for (const root of project.roots) {
      let physical: string;
      try {
        physical = await realpath(root);
      } catch (error) {
        if (missing(error)) continue;
        throw error;
      }
      if (physical === "/")
        throw new Error("filesystem root is not a project binding");
      if (!(await stat(physical)).isDirectory())
        throw new Error("memory project root must be a directory");
      const previous = physicalRoots.get(physical);
      if (previous !== undefined && previous.key !== project.key)
        throw new Error("ambiguous memory project physical directory");
      physicalRoots.set(physical, project);
    }
  }
  const matched = [...physicalRoots.entries()]
    .filter(([root]) => realCwd === root || realCwd.startsWith(`${root}/`))
    .sort(([a], [b]) => b.length - a.length)[0];
  if (matched === undefined)
    return AgentMemoryRunSourceSchema.parse({
      cwd,
      realCwd,
      catalogDigest,
      resolution: "unmatched",
    });
  const [matchedRoot, project] = matched;
  return AgentMemoryRunSourceSchema.parse({
    cwd,
    realCwd,
    catalogDigest,
    resolution: "matched",
    matchedRoot,
    project: { key: project.key, label: project.label },
    relatedKeys: project.relatedKeys,
  });
}

async function readPrivateCatalog(path: string): Promise<Buffer | null> {
  let handle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  try {
    const before = await handle.stat();
    assertPrivate(before, false);
    if (before.size > MAX_CATALOG_BYTES)
      throw new Error("memory project catalog exceeds 256 KiB");
    // Bound the actual read too: a concurrently growing file cannot allocate
    // an unbounded buffer after passing the initial stat check.
    const buffer = Buffer.alloc(MAX_CATALOG_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_CATALOG_BYTES)
      throw new Error("memory project catalog exceeds 256 KiB");
    const after = await handle.stat();
    const current = await lstat(path);
    assertPrivate(after, false);
    assertPrivate(current, false);
    if (
      before.size !== length ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      after.dev !== current.dev ||
      after.ino !== current.ino ||
      after.mtimeMs !== current.mtimeMs ||
      after.ctimeMs !== current.ctimeMs
    )
      throw new Error("memory project catalog changed during read");
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}

function assertPrivate(metadata: Stats, directory: boolean): void {
  if (
    metadata.isSymbolicLink() ||
    (directory
      ? !metadata.isDirectory()
      : !metadata.isFile() || metadata.nlink !== 1) ||
    (metadata.mode & 0o077) !== 0 ||
    (process.getuid !== undefined && metadata.uid !== process.getuid())
  )
    throw new Error(
      "memory project catalog/root must be private and owner-controlled",
    );
}
function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
