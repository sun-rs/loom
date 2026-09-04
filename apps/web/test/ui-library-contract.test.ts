import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import test from "node:test";
import {
  validateLibrary,
  libraryPath,
  adoptionPath,
  libraryInputs,
} from "../../../scripts/ui-library-contract.mjs";

const read = (path: string) => readFileSync(path);
const library = JSON.parse(read(libraryPath).toString());
const adoption = JSON.parse(read(adoptionPath).toString());
const registry = JSON.parse(
  read("docs/product/ui-behavior-registry.json").toString(),
);
const check = (l = library, a = adoption, reader = read) =>
  validateLibrary(l, a, registry, reader);

test("the English catalog links actual source, template examples and existing behavior scenarios", () => {
  assert.deepEqual(check(), []);
  assert.equal(library.name, "RAH Neo-Brutalist UI");
  const inputs = libraryInputs();
  for (const file of [
    libraryPath,
    adoptionPath,
    library.components[0].owner,
    adoption.files[0].path,
  ]) {
    assert.ok(inputs.includes(file), file);
  }
});

test("catalog validation rejects unsafe, duplicate, unlinked and immutable-drift evidence", () => {
  for (const mutate of [
    (l: typeof library) => l.components.push(l.components[0]),
    (l: typeof library) => (l.components[0].owner = "../raft-ui/icon.tsx"),
    (l: typeof library) => (l.components[0].behaviors = ["nonexistent"]),
    (l: typeof library) => (l.templates[0].components = ["nonexistent"]),
  ]) {
    const copy = structuredClone(library);
    mutate(copy);
    assert.ok(check(copy).length > 0);
  }
  const asset = adoption.files.find(
    (f: { policy: string }) => f.policy === "immutable-asset",
  );
  assert.ok(
    check(library, adoption, (p) =>
      p === asset.path ? Buffer.from("changed") : read(p),
    ).some((e: string) => e.includes("immutable asset changed")),
  );
});

test("maintained source can evolve with recorded changes, without rewriting its origin", () => {
  const copy = structuredClone(adoption);
  const css = copy.files.find(
    (f: { policy: string }) => f.policy === "maintained-source",
  );
  const changed = (p: string) =>
    p === css.path
      ? Buffer.from("/* intentional product correction */")
      : read(p);
  css.changes = [];
  assert.ok(
    check(library, copy, changed).some((e: string) =>
      e.includes("undocumented adoption change"),
    ),
  );
  css.changes = [
    "Source-backed correction, tested by the affected behavior scenario.",
  ];
  assert.deepEqual(check(library, copy, changed), []);
});

test("all stylesheet imports and font URLs resolve inside the internal library without duplicate CSS loads", () => {
  const seen = new Set<string>();
  const root = resolve("packages/ui-tokens/src/neo-brutalist");
  const visit = (path: string) => {
    assert.equal(seen.has(path), false, `duplicate stylesheet: ${path}`);
    seen.add(path);
    const css = readFileSync(path, "utf8");
    for (const match of css.matchAll(
      /(?:@import\s+["']([^"']+)["']|url\(["']?([^"')]+)["']?\))/g,
    )) {
      const target = resolve(dirname(path), (match[1] ?? match[2])!);
      assert.ok(!relative(root, target).startsWith(".."), target);
      assert.ok(existsSync(target), target);
      if (match[1]) visit(target);
    }
  };
  visit(resolve(root, "index.css"));
});
