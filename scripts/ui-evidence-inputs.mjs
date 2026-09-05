import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, resolve } from "node:path";

const DEFAULT_ROOTS = ["apps/web/src", "apps/web/test", "scripts"];
const DEFAULT_CONFIGS = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "apps/web/package.json",
  "apps/web/tsconfig.json",
  "apps/web/vite.config.ts",
];
const REGISTRY_PATH = "docs/product/ui-behavior-registry.json";
const ADOPTION_PATH = "packages/ui-tokens/adoption.json";
const LIBRARY_PATH = "packages/ui-tokens/neo-brutalist-library.json";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function safeRelativePath(path) {
  assert.equal(typeof path, "string");
  const normalized = posix.normalize(path.replaceAll("\\", "/"));
  assert.ok(
    normalized &&
      normalized !== "." &&
      !normalized.startsWith("/") &&
      normalized !== ".." &&
      !normalized.startsWith("../"),
    `Unsafe UI evidence input: ${path}`,
  );
  return normalized;
}

function collectFiles(repositoryRoot, relativeRoot, output) {
  const absoluteRoot = resolve(repositoryRoot, relativeRoot);
  let entries;
  try {
    entries = readdirSync(absoluteRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const absolute = join(absoluteRoot, entry.name);
    const path = relative(repositoryRoot, absolute).replaceAll("\\", "/");
    if (entry.isDirectory()) collectFiles(repositoryRoot, path, output);
    else if (entry.isFile()) output.add(safeRelativePath(path));
  }
}

// validateRegistry/checkLibrary read these indirect paths. Keep them in the
// same freshness receipt as the executable source rather than trusting only
// the JSON record that points at them.
export function uiContractEvidenceInputPaths(repositoryRoot = process.cwd()) {
  const readJson = (path) =>
    JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"));
  const registry = readJson(REGISTRY_PATH);
  const adoption = readJson(ADOPTION_PATH);
  const library = readJson(LIBRARY_PATH);
  return [
    REGISTRY_PATH,
    ADOPTION_PATH,
    LIBRARY_PATH,
    registry.legacyInventory,
    ...registry.sources.map((source) => source.path),
    adoption.originManifest,
    ...adoption.files.map((file) => file.path),
    ...[...library.components, ...library.templates].flatMap((item) => [
      item.owner,
      item.example,
      ...(item.styles ?? []),
    ]),
  ]
    .map(safeRelativePath)
    .filter((path, index, paths) => paths.indexOf(path) === index)
    .sort();
}

export function collectUiEvidenceInputPaths(options = {}) {
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd());
  const roots = [...(options.roots ?? DEFAULT_ROOTS)];
  if (options.roots === undefined) {
    for (const entry of readdirSync(join(repositoryRoot, "packages"), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      roots.push(`packages/${entry.name}/src`, `packages/${entry.name}/test`);
    }
  }
  const configs = [...(options.configs ?? DEFAULT_CONFIGS)];
  if (options.configs === undefined) {
    for (const entry of readdirSync(join(repositoryRoot, "packages"), {
      withFileTypes: true,
    }))
      if (entry.isDirectory())
        configs.push(`packages/${entry.name}/package.json`);
  }
  const paths = new Set();
  for (const root of roots)
    collectFiles(repositoryRoot, safeRelativePath(root), paths);
  for (const path of [...configs, ...(options.extraPaths ?? [])]) {
    const safe = safeRelativePath(path);
    const absolute = resolve(repositoryRoot, safe);
    try {
      if (statSync(absolute).isFile()) paths.add(safe);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      // Optional configuration paths may be absent. snapshotUiEvidenceInputs
      // separately requires every explicitly named evidence input.
    }
  }
  return [...paths].sort();
}

export function snapshotUiEvidenceInputs(options = {}) {
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd());
  const paths = collectUiEvidenceInputPaths(options);
  for (const path of options.extraPaths ?? [])
    assert.ok(
      paths.includes(safeRelativePath(path)),
      `Missing explicit UI evidence input: ${path}`,
    );
  return Object.fromEntries(
    paths.map((path) => [
      path,
      digest(readFileSync(resolve(repositoryRoot, path))),
    ]),
  );
}

export function assertUiEvidenceInputSnapshot(snapshot, options = {}) {
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd());
  const currentPaths = collectUiEvidenceInputPaths(options);
  assert.deepEqual(
    currentPaths,
    Object.keys(snapshot).sort(),
    "UI evidence input file set changed during test",
  );
  for (const path of currentPaths)
    assert.equal(
      digest(readFileSync(resolve(repositoryRoot, path))),
      snapshot[path],
      `UI evidence input changed during test: ${path}`,
    );
}
