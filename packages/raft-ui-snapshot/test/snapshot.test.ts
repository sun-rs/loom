import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

type SnapshotManifest = {
  files: Array<{ bytes: number; path: string; sha256: string }>;
  schemaVersion: 1;
  source: {
    dirty: boolean;
    gitHead: string;
    repository: "raft-ui";
  };
};

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the Raft UI snapshot is immutable, complete, and reference-only", () => {
  const manifest = JSON.parse(
    readFileSync(join(packageRoot, "snapshot-manifest.json"), "utf8"),
  ) as SnapshotManifest;

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.source.repository, "raft-ui");
  assert.match(manifest.source.gitHead, /^[a-f0-9]{40}$/);
  assert.ok(manifest.files.length > 50);
  assert.deepEqual(
    manifest.files.map(({ path }) => path),
    manifest.files.map(({ path }) => path).sort(),
  );

  for (const entry of manifest.files) {
    assert.ok(!entry.path.startsWith("/"));
    assert.ok(!entry.path.includes(".."));
    const content = readFileSync(join(packageRoot, "reference", entry.path));
    assert.equal(content.byteLength, entry.bytes, entry.path);
    assert.equal(
      createHash("sha256").update(content).digest("hex"),
      entry.sha256,
      entry.path,
    );
  }

  for (const route of [
    "activity.html",
    "admin.html",
    "agents.html",
    "billing.html",
    "computers.html",
    "index.html",
    "members.html",
    "search.html",
    "settings.html",
    "slack.html",
    "tasks.html",
  ]) {
    const html = readFileSync(join(packageRoot, "reference", route), "utf8");
    assert.match(html, /raft-ui-reference-adapter\.js/, route);
    assert.doesNotMatch(html, /raft-ui-rah-client-adapter\.js/, route);
  }
});
