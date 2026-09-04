import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { pathToFileURL } from "node:url";

export const libraryPath = "packages/ui-tokens/neo-brutalist-library.json";
export const adoptionPath = "packages/ui-tokens/adoption.json";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function validateLibrary(library, adoption, registry, read) {
  const errors = [];
  const get = (path) => {
    if (
      typeof path !== "string" ||
      !path ||
      path.startsWith("/") ||
      path.split(/[\\/]/).includes("..")
    ) {
      errors.push(`unsafe path: ${path}`);
      return;
    }
    try {
      return read(path);
    } catch {
      errors.push(`missing: ${path}`);
    }
  };
  if (library.schemaVersion !== 1 || adoption.schemaVersion !== 1)
    errors.push("unsupported library schema");
  const origin = get(adoption.originManifest);
  if (origin && sha(origin) !== adoption.originManifestSha256)
    errors.push("origin manifest drift");
  const sourceFiles = new Map(
    origin ? JSON.parse(origin.toString()).files.map((f) => [f.path, f]) : [],
  );
  const paths = new Set();
  for (const file of adoption.files) {
    if (paths.has(file.path)) errors.push(`duplicate asset: ${file.path}`);
    paths.add(file.path);
    const bytes = get(file.path);
    if (sourceFiles.get(file.originPath)?.sha256 !== file.originSha256)
      errors.push(`origin mismatch: ${file.path}`);
    if (!["immutable-asset", "maintained-source"].includes(file.policy))
      errors.push(`invalid policy: ${file.path}`);
    if (bytes && sha(bytes) !== file.originSha256) {
      if (file.policy === "immutable-asset")
        errors.push(`immutable asset changed: ${file.path}`);
      else if (!file.changes?.length)
        errors.push(`undocumented adoption change: ${file.path}`);
    }
  }
  const ids = new Set();
  const behaviors = new Set(registry.behaviors.map((b) => b.id));
  const scenarios = new Set(registry.scenarios.map((s) => s.id));
  for (const item of [...library.components, ...library.templates]) {
    if (!item.id || ids.has(item.id))
      errors.push(`duplicate library ID: ${item.id}`);
    ids.add(item.id);
    get(item.owner);
    for (const style of item.styles ?? []) get(style);
    get(item.example);
    if (!item.description || !item.behaviors?.length || !item.scenarios?.length)
      errors.push(`incomplete contract: ${item.id}`);
    for (const id of item.behaviors ?? [])
      if (!behaviors.has(id)) errors.push(`unknown behavior: ${id}`);
    for (const id of item.scenarios ?? [])
      if (!scenarios.has(id)) errors.push(`unknown scenario: ${id}`);
  }
  const componentIds = new Set(library.components.map((c) => c.id));
  for (const template of library.templates) {
    if (!template.components?.length)
      errors.push(`empty template: ${template.id}`);
    for (const id of template.components ?? [])
      if (!componentIds.has(id)) errors.push(`unknown component: ${id}`);
  }
  return errors;
}

// These hashes travel with browser receipts. Moving a component outside the app
// must not make its changes invisible to the existing evidence freshness check.
export function libraryInputs() {
  return [
    libraryPath,
    adoptionPath,
    "packages/ui-web/package.json",
    "packages/ui-tokens/package.json",
    ...["packages/ui-tokens/src", "packages/ui-web/src/neo-brutalist"].flatMap(
      (root) =>
        readdirSync(root, { recursive: true, withFileTypes: true })
          .filter((e) => e.isFile())
          .map((e) => relative(process.cwd(), resolve(e.parentPath, e.name))),
    ),
  ].sort();
}

export function checkLibrary() {
  const read = (p) => readFileSync(p);
  const errors = validateLibrary(
    JSON.parse(read(libraryPath)),
    JSON.parse(read(adoptionPath)),
    JSON.parse(read("docs/product/ui-behavior-registry.json")),
    read,
  );
  if (errors.length) throw new Error(errors.join("\n"));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  checkLibrary();
  process.stdout.write(
    "RAH Neo-Brutalist UI catalog and adoption evidence are valid.\n",
  );
}
