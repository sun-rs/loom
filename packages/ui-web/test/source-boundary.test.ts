import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repositoryRoot = join(import.meta.dirname, "..", "..", "..");

test("the product UI consumes the maintained library without embedding the Raft reference", () => {
  const productSourceDirectory = join(repositoryRoot, "apps", "web", "src");
  const productSource = [
    ...sourceFiles(productSourceDirectory),
    ...sourceFiles(join(repositoryRoot, "packages/ui-web/src/neo-brutalist")),
  ]
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

  assert.doesNotMatch(productSource, /raft-ui-reference-adapter/);
  assert.doesNotMatch(productSource, /(?:^|["'])\.\.\/raft-ui/);
  assert.doesNotMatch(productSource, /reference\/[a-z-]+\.html/);
  assert.doesNotMatch(productSource, /raft-ui-snapshot/);
  assert.match(productSource, /@rah-os\/ui-tokens\/neo-brutalist\.css/);
  assert.match(productSource, /@rah-os\/ui-tokens\/icons\.svg/);

  const uiWebPackage = readFileSync(
    join(repositoryRoot, "packages", "ui-web", "package.json"),
    "utf8",
  );
  assert.doesNotMatch(uiWebPackage, /raft-ui-snapshot/);
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:css|ts|tsx)$/u.test(entry.name) ? [path] : [];
  });
}
