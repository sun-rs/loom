import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repositoryRoot = join(import.meta.dirname, "..", "..", "..");

test("the product UI consumes generated tokens without embedding the Raft reference", () => {
  const productSource = ["App.tsx", "main.tsx", "product.css"]
    .map((file) =>
      readFileSync(join(repositoryRoot, "apps", "web", "src", file), "utf8"),
    )
    .join("\n");

  assert.doesNotMatch(productSource, /raft-ui-reference-adapter/);
  assert.doesNotMatch(productSource, /(?:^|["'])\.\.\/raft-ui/);
  assert.doesNotMatch(productSource, /reference\/[a-z-]+\.html/);
  assert.doesNotMatch(productSource, /raft-ui-snapshot/);
  assert.match(productSource, /@rah-os\/ui-tokens\/styles\.css/);
  assert.match(productSource, /@rah-os\/ui-tokens\/icons\.svg/);

  const uiWebPackage = readFileSync(
    join(repositoryRoot, "packages", "ui-web", "package.json"),
    "utf8",
  );
  assert.doesNotMatch(uiWebPackage, /raft-ui-snapshot/);
});
