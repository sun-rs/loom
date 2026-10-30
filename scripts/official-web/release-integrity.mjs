import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync, lstatSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverResources, sourcePath } from "./capture-release.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sorted = (values) => [...values].sort();
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/** Verify original bytes AND rederive every static edge; a version label is insufficient. */
export function verifyRelease(directory, expected = {}) {
  const root = realpathSync(directory);
  const lock = JSON.parse(
    readFileSync(resolve(root, "release-lock.json"), "utf8"),
  );
  if (
    !lock.staticClosureComplete ||
    lock.failed.length ||
    lock.missingEdges.length
  )
    throw Error("Incomplete release graph");
  if (expected.releaseId && lock.release.releaseId !== expected.releaseId)
    throw Error("Release identity mismatch");
  const urls = new Set(),
    paths = new Set();
  let totalBytes = 0,
    modules = 0;
  const dynamic = [];
  for (const record of lock.files) {
    if (urls.has(record.url) || paths.has(record.file))
      throw Error("Duplicate release resource");
    if (record.file !== sourcePath(record.url))
      throw Error("Unsafe or noncanonical resource path");
    const filename = resolve(root, record.file);
    if (
      !filename.startsWith(root + sep) ||
      lstatSync(filename).isSymbolicLink() ||
      realpathSync(filename) !== filename
    )
      throw Error("Unsafe resource path");
    const bytes = readFileSync(filename);
    if (bytes.length !== record.bytes || digest(bytes) !== record.sha256)
      throw Error("Original resource bytes/hash mismatch: " + record.file);
    const edges = discoverResources(
      bytes.toString("utf8"),
      record.mime,
      record.url,
    );
    if (
      !same(edges, record.dependencies) ||
      !same(edges.dynamicImports, record.dynamicImports)
    )
      throw Error("Release dependencies/graph mismatch: " + record.file);
    if (edges.dynamicImports.length)
      dynamic.push({ url: record.url, expressions: edges.dynamicImports });
    totalBytes += bytes.length;
    if (
      record.url.startsWith("https://app.raft.build/") &&
      /\.m?js$/.test(new URL(record.url).pathname)
    )
      modules++;
    urls.add(record.url);
    paths.add(record.file);
  }
  for (const record of lock.files)
    for (const edge of record.dependencies)
      if (!urls.has(edge)) throw Error("Missing release dependency: " + edge);
  const byUrl = new Map(lock.files.map((record) => [record.url, record]));
  const reachable = new Set();
  const visit = (url) => {
    if (reachable.has(url)) return;
    reachable.add(url);
    for (const dependency of byUrl.get(url)?.dependencies ?? [])
      visit(dependency);
  };
  visit(lock.entry);
  if (reachable.size !== urls.size)
    throw Error("Unreachable resource mixed into release graph");
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(filename);
      else if (!paths.has(relative(root, filename).split(sep).join("/")))
        throw Error("Unlocked candidate file: " + filename);
    }
  };
  walk(resolve(root, "files"));
  const entry = lock.files.find((r) => r.url === lock.entry);
  if (!entry || entry.sha256 !== lock.entrySha256)
    throw Error("Entry identity/hash mismatch");
  const html = readFileSync(resolve(root, entry.file), "utf8");
  const identity = JSON.parse(
    html.match(/id="raft-frontend-release-identity"[^>]*>([^<]+)/)?.[1] ??
      "null",
  );
  if (JSON.stringify(identity) !== JSON.stringify(lock.release))
    throw Error("HTML release identity mismatch");
  return {
    release: lock.release,
    files: paths.size,
    modules,
    totalBytes,
    nonliteralImports: dynamic,
    originalBytesVerified: true,
    staticClosureComplete: true,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(JSON.stringify(verifyRelease(process.argv[2]), null, 2));
