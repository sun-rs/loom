import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { withPinnedRelease } from "./pinned-release.mjs";

test("the retained Web dependency is one complete immutable 1.21.40 graph", async () => {
  await withPinnedRelease(async ({ directory, metadata, verification }) => {
    assert.equal(metadata.version, "1.21.40");
    assert.equal(
      metadata.release.releaseId,
      "a7bb80017084e766d68b8a1d7c6377496a16fbaa",
    );
    assert.equal(verification.files, 316);
    assert.equal(verification.modules, 219);
    assert.equal(verification.originalBytesVerified, true);
    assert.ok(
      existsSync(
        directory + "/files/app.raft.build/assets/app-shell-DOYrxQ-_.js",
      ),
    );
    assert.equal(metadata.businessAdapterComplete, false);
    assert.equal(
      metadata.actualBundledUi.singleRuntimeReplacementVerified,
      false,
    );
  });
});

test("the UI reference archive retains the entire official 0.52.2 Git tree", () => {
  const root = "frontends/raft/upstream/releases/";
  const metadata = JSON.parse(
    readFileSync(root + "raft-design-0.52.2-source.json", "utf8"),
  );
  const archive = root + metadata.archive;
  assert.equal(
    createHash("sha256").update(readFileSync(archive)).digest("hex"),
    metadata.sha256,
  );
  const prefix = "raft-design-0.52.2/";
  const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((path) => !path.endsWith("/"))
    .map((path) => {
      assert.ok(path.startsWith(prefix));
      return path.slice(prefix.length);
    });
  assert.equal(entries.length, 1839);
  for (const path of [
    "LICENSE",
    "packages/ui/src/components/badge/badge.tsx",
    "packages/ui/src/components/panel/panel-action.tsx",
    "packages/ui/package.json",
  ])
    assert.ok(entries.includes(path), path);
  const pkg = JSON.parse(
    execFileSync(
      "tar",
      ["-xOzf", archive, prefix + "packages/ui/package.json"],
      { encoding: "utf8" },
    ),
  );
  assert.equal(pkg.version, "0.52.2");
});
