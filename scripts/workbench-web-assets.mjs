import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  stat,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { webBuildOutput } from "../apps/web/build-output.ts";
import {
  BUILD_IDENTITY_META_NAME,
  buildIdentitiesAgree,
  decodeBuildIdentityMeta,
  parseBuildIdentity,
} from "./release-version.mjs";

// Product builds and validation builds never share an output directory.
export { webBuildOutput };

const RELEASE_NAME = /^[a-f0-9]{64}$/u;
const RELEASE_LEASE_SCHEMA_VERSION = 1;
const DEFAULT_RELEASE_RETENTION = 4;
const DEFAULT_RELEASE_MINIMUM_AGE_MS = 10 * 60 * 1000;

export async function acquireWorkbenchAssetLease(
  repositoryDirectory,
  staticDirectory,
) {
  const releases = resolve(repositoryDirectory, ".workbench-web");
  const release = resolve(staticDirectory);
  if (
    dirname(release) !== releases ||
    !RELEASE_NAME.test(release.slice(releases.length + 1))
  ) {
    return Object.freeze({ release: async () => {} });
  }
  const releaseMetadata = await lstat(release);
  if (!releaseMetadata.isDirectory() || releaseMetadata.isSymbolicLink()) {
    throw new Error("Workbench release lease target must be a real directory");
  }
  const leases = join(releases, ".leases");
  await mkdir(leases, { recursive: true, mode: 0o700 });
  const leasePath = join(leases, `${String(process.pid)}-${randomUUID()}.json`);
  await withReleaseStoreLock(releases, async () => {
    await writeFile(
      leasePath,
      JSON.stringify({
        processId: process.pid,
        releaseDirectory: release,
        schemaVersion: RELEASE_LEASE_SCHEMA_VERSION,
        startedAt: new Date().toISOString(),
      }),
      { flag: "wx", mode: 0o600 },
    );
  });
  let released = false;
  return Object.freeze({
    async release() {
      if (released) return;
      released = true;
      await withReleaseStoreLock(releases, () =>
        rm(leasePath, { force: true }),
      );
    },
  });
}

export async function pruneWorkbenchAssetSnapshots(
  repositoryDirectory,
  options = {},
) {
  const releases = resolve(repositoryDirectory, ".workbench-web");
  const retainRecent = boundedInteger(
    options.retainRecent ?? DEFAULT_RELEASE_RETENTION,
    "retainRecent",
    1,
    32,
  );
  const minimumAgeMs = boundedInteger(
    options.minimumAgeMs ?? DEFAULT_RELEASE_MINIMUM_AGE_MS,
    "minimumAgeMs",
    0,
    7 * 24 * 60 * 60 * 1000,
  );
  const now = options.now ?? (() => new Date());
  await mkdir(releases, { recursive: true });
  return withReleaseStoreLock(releases, async () => {
    const liveReleases = await collectLiveReleaseLeases(releases);
    const entries = await readdir(releases, { withFileTypes: true });
    const candidates = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !RELEASE_NAME.test(entry.name)) continue;
      const path = join(releases, entry.name);
      const metadata = await stat(path);
      candidates.push({ modifiedAtMs: metadata.mtimeMs, path });
    }
    candidates.sort(
      (left, right) =>
        right.modifiedAtMs - left.modifiedAtMs ||
        right.path.localeCompare(left.path),
    );
    const retained = new Set(
      candidates.slice(0, retainRecent).map(({ path }) => path),
    );
    const cutoff = now().getTime() - minimumAgeMs;
    const removedDirectories = [];
    for (const candidate of candidates) {
      if (
        retained.has(candidate.path) ||
        liveReleases.has(candidate.path) ||
        candidate.modifiedAtMs > cutoff
      ) {
        continue;
      }
      const metadata = await lstat(candidate.path);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error("Workbench release cleanup target changed type");
      }
      await rm(candidate.path, { recursive: true, force: false });
      removedDirectories.push(candidate.path);
    }
    return Object.freeze({
      removedDirectories: Object.freeze(removedDirectories),
      retainedDirectories: Object.freeze(
        candidates
          .map(({ path }) => path)
          .filter((path) => !removedDirectories.includes(path)),
      ),
    });
  });
}

export async function snapshotWorkbenchAssets(
  repositoryDirectory,
  pinnedDirectory,
) {
  const source =
    pinnedDirectory ??
    join(repositoryDirectory, "apps/web", webBuildOutput(true));
  const files = [];
  async function collect(relative = "") {
    for (const entry of (
      await readdir(join(source, relative), { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await collect(path);
      else if (entry.isFile())
        files.push([path, await readFile(join(source, path))]);
      else throw new Error("Workbench assets must be regular files");
    }
  }
  await collect();
  if (!files.some(([path]) => path === "index.html"))
    throw new Error("Product index.html is missing; run build:web:workbench");
  const assets = new Map(files);
  const metadataBytes = assets.get(".rah-web-build.json");
  if (metadataBytes === undefined)
    throw new Error("Product Web build metadata is missing");
  let webBuildId;
  let bundleIdentity;
  try {
    const metadata = JSON.parse(metadataBytes.toString());
    if (
      metadata === null ||
      typeof metadata !== "object" ||
      metadata.schemaVersion !== 1 ||
      typeof metadata.webBuildId !== "string" ||
      !/^[A-Za-z0-9._:-]{1,128}$/u.test(metadata.webBuildId)
    ) {
      throw new Error("invalid Web build metadata");
    }
    webBuildId = metadata.webBuildId;
    bundleIdentity = metadata.buildIdentity;
  } catch (error) {
    throw new Error("Product Web build metadata is invalid", {
      cause: error,
    });
  }
  const index = assets.get("index.html").toString();
  assertBundleIdentityAgreement(index, bundleIdentity);
  const embeddedBuildIds = Array.from(
    index.matchAll(
      /<meta\s+name=["']rah-web-build-id["']\s+content=["']([^"']+)["']\s*\/?\s*>/giu,
    ),
    (match) => match[1],
  );
  if (embeddedBuildIds.length !== 1 || embeddedBuildIds[0] !== webBuildId) {
    throw new Error(
      "Product index.html Web build identity does not match its metadata",
    );
  }
  function requireAsset(reference, from = "index.html") {
    if (/^(?:[a-z]+:|\/\/|#)/i.test(reference)) return;
    const localPath = reference.split(/[?#]/)[0];
    const path = posix.normalize(
      localPath.startsWith("/")
        ? localPath.slice(1)
        : posix.join(posix.dirname(from), localPath),
    );
    if (!assets.has(path)) throw new Error(`Product asset is missing: ${path}`);
  }
  for (const match of index.matchAll(/\b(?:src|href)=["']([^"']+)["']/g))
    requireAsset(match[1]);
  const manifestBytes = assets.get(".vite/manifest.json");
  if (manifestBytes) {
    const manifest = JSON.parse(manifestBytes.toString());
    for (const entry of Object.values(manifest)) {
      for (const file of [
        entry.file,
        ...(entry.css ?? []),
        ...(entry.assets ?? []),
      ])
        requireAsset(file);
      for (const id of [
        ...(entry.imports ?? []),
        ...(entry.dynamicImports ?? []),
      ]) {
        if (!manifest[id])
          throw new Error(`Product manifest dependency is missing: ${id}`);
      }
    }
  }
  for (const [path, bytes] of files.filter(([path]) => path.endsWith(".css"))) {
    for (const match of bytes
      .toString()
      .matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g))
      requireAsset(match[1], path);
  }
  const hash = createHash("sha256");
  for (const [path, bytes] of files)
    hash.update(JSON.stringify([path, bytes.length])).update(bytes);
  const releases = join(repositoryDirectory, ".workbench-web");
  await mkdir(releases, { recursive: true });
  const destination = join(releases, hash.digest("hex"));
  const staging = await mkdtemp(join(releases, "staging-"));
  try {
    // Write the exact bytes that were hashed, not a second read of a mutable build.
    for (const [path, bytes] of files) {
      const parent = path.includes("/")
        ? path.slice(0, path.lastIndexOf("/"))
        : "";
      await mkdir(join(staging, parent), { recursive: true });
      await writeFile(join(staging, path), bytes, { flag: "wx", mode: 0o444 });
    }
    try {
      await rename(staging, destination);
    } catch (error) {
      if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error;
      // Never reuse a corrupted release merely because its directory name matches.
      for (const [path, bytes] of files) {
        if (!(await readFile(join(destination, path))).equals(bytes))
          throw new Error("Frozen Web release was modified");
      }
    }
    return destination;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/**
 * The bundle states its release identity twice: in `index.html` for the browser
 * and in `.rah-web-build.json` for the launcher and the product build. They are
 * one build, so they must agree exactly; one present without the other, or two
 * different identities, is a corrupt or mixed bundle and is refused.
 */
function assertBundleIdentityAgreement(index, metadataIdentity) {
  const encoded = Array.from(
    index.matchAll(
      new RegExp(
        `<meta\\s+name=["']${BUILD_IDENTITY_META_NAME}["']\\s+content=["']([^"']+)["']\\s*/?\\s*>`,
        "giu",
      ),
    ),
    (match) => match[1],
  );
  if (encoded.length > 1) {
    throw new Error(
      "Product index.html declares more than one release identity",
    );
  }
  const indexIdentity =
    encoded.length === 1 ? decodeBuildIdentityMeta(encoded[0]) : undefined;
  if (encoded.length === 1 && indexIdentity === undefined) {
    throw new Error("Product index.html release identity is invalid");
  }
  if (indexIdentity === undefined && metadataIdentity === undefined) return;
  if (indexIdentity === undefined || metadataIdentity === undefined) {
    throw new Error(
      "Product Web build declares its release identity in only one place; rebuild it with build:web:workbench",
    );
  }
  const declared = parseBuildIdentity(JSON.stringify(metadataIdentity));
  if (!buildIdentitiesAgree(indexIdentity, declared)) {
    throw new Error(
      `Product Web build identity disagrees: index.html says ${indexIdentity.version} (build ${indexIdentity.buildId}), metadata says ${declared.version} (build ${declared.buildId})`,
    );
  }
}

/**
 * The release identity of an already-snapshotted Web bundle. The launcher hands
 * exactly this to the daemon so a development workbench reports one identity for
 * the bundle it serves.
 */
export async function readWorkbenchAssetIdentity(staticDirectory) {
  let metadata;
  try {
    metadata = JSON.parse(
      await readFile(join(staticDirectory, ".rah-web-build.json"), "utf8"),
    );
  } catch {
    return undefined;
  }
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    metadata.schemaVersion !== 1 ||
    metadata.buildIdentity === undefined
  ) {
    return undefined;
  }
  const index = await readFile(join(staticDirectory, "index.html"), "utf8");
  assertBundleIdentityAgreement(index, metadata.buildIdentity);
  return parseBuildIdentity(JSON.stringify(metadata.buildIdentity));
}

async function collectLiveReleaseLeases(releases) {
  const leases = join(releases, ".leases");
  await mkdir(leases, { recursive: true, mode: 0o700 });
  const live = new Set();
  for (const entry of await readdir(leases, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const leasePath = join(leases, entry.name);
    let lease;
    try {
      lease = JSON.parse(await readFile(leasePath, "utf8"));
    } catch {
      await rm(leasePath, { force: true });
      continue;
    }
    const release = resolve(String(lease.releaseDirectory ?? ""));
    const processId = Number(lease.processId);
    if (
      lease.schemaVersion !== RELEASE_LEASE_SCHEMA_VERSION ||
      !Number.isSafeInteger(processId) ||
      processId <= 0 ||
      dirname(release) !== releases ||
      !RELEASE_NAME.test(release.slice(releases.length + 1)) ||
      !processIsAlive(processId)
    ) {
      await rm(leasePath, { force: true });
      continue;
    }
    live.add(release);
  }
  return live;
}

function processIsAlive(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function withReleaseStoreLock(releases, operation) {
  const lockPath = join(releases, ".gc-lock");
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      await writeFile(
        lockPath,
        JSON.stringify({ processId: process.pid, startedAt: Date.now() }),
        { flag: "wx", mode: 0o600 },
      );
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let lock;
      try {
        lock = JSON.parse(await readFile(lockPath, "utf8"));
      } catch {
        lock = undefined;
      }
      if (!processIsAlive(Number(lock?.processId))) {
        await rm(lockPath, { force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for Workbench release cleanup lock");
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    }
  }
  try {
    return await operation();
  } finally {
    await rm(lockPath, { force: true });
  }
}

function boundedInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}
