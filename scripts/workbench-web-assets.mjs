import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { join, posix } from "node:path";
import { webBuildOutput } from "../apps/web/build-output.ts";

// Product builds and validation builds never share an output directory.
export { webBuildOutput };

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
  for (const match of assets
    .get("index.html")
    .toString()
    .matchAll(/\b(?:src|href)=["']([^"']+)["']/g))
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
