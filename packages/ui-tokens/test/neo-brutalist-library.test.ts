import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("the internal library exports maintained source, not snapshot-generated output", () => {
  const pkg = JSON.parse(read("packages/ui-tokens/package.json"));
  assert.equal(
    pkg.exports["./neo-brutalist.css"],
    "./src/neo-brutalist/index.css",
  );
  for (const path of Object.values(pkg.exports) as string[]) {
    assert.ok(path.startsWith("./src/"), path);
    assert.ok(existsSync(join(root, "packages/ui-tokens", path)), path);
  }
  assert.equal(existsSync(join(root, "packages/ui-tokens/generated")), false);
});

test("maintenance cannot overwrite product assets from an external reference checkout", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["ui:snapshot:import"], undefined);
  assert.equal(pkg.scripts["ui:tokens:generate"], undefined);
  assert.equal(
    existsSync(join(root, "scripts/import-raft-ui-snapshot.mjs")),
    false,
  );
  assert.equal(existsSync(join(root, "scripts/generate-ui-tokens.mjs")), false);
});

test("production has one library stylesheet entry and no duplicate foundation owners", () => {
  const entry = read("apps/web/src/product-styles.ts");
  assert.equal((entry.match(/@rah-os\/ui-tokens\//g) ?? []).length, 1);
  assert.match(entry, /@rah-os\/ui-tokens\/neo-brutalist\.css/);
  for (const name of [
    "interaction-state.css",
    "panel-layout.css",
    "panel-foundations.css",
  ]) {
    assert.equal(existsSync(join(root, "apps/web/src", name)), false, name);
    assert.ok(
      existsSync(join(root, "packages/ui-tokens/src/neo-brutalist", name)),
    );
  }
  for (const name of [
    "icon",
    "panel-header",
    "panel-header-action",
    "panel-tabs",
    "panel-resizer",
  ]) {
    assert.equal(
      existsSync(join(root, "apps/web/src/components", `${name}.tsx`)),
      false,
    );
    const component = read(`packages/ui-web/src/neo-brutalist/${name}.tsx`);
    assert.doesNotMatch(
      component,
      /client-sdk|client-core|localStorage|fetch\(/,
    );
  }
});
