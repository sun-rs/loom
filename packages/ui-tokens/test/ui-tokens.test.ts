import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const packageRoot = join(import.meta.dirname, "..");
const repositoryRoot = join(packageRoot, "..", "..");

type GeneratedManifest = {
  files: Array<{
    bytes: number;
    outputPath: string;
    sha256: string;
    sourcePath: string;
  }>;
  schemaVersion: 1;
  source: {
    dirty: boolean;
    gitHead: string;
    repository: "raft-ui";
  };
};

type SnapshotManifest = {
  files: Array<{ bytes: number; path: string; sha256: string }>;
  schemaVersion: 1;
  source: GeneratedManifest["source"];
};

test("product UI assets are a narrow generated projection of the Raft reference", () => {
  const generated = JSON.parse(
    readFileSync(
      join(packageRoot, "generated", "generated-manifest.json"),
      "utf8",
    ),
  ) as GeneratedManifest;
  const snapshot = JSON.parse(
    readFileSync(
      join(
        repositoryRoot,
        "packages",
        "raft-ui-snapshot",
        "snapshot-manifest.json",
      ),
      "utf8",
    ),
  ) as SnapshotManifest;

  assert.equal(generated.schemaVersion, 1);
  assert.deepEqual(generated.source, snapshot.source);
  assert.deepEqual(
    generated.files.map(({ sourcePath }) => sourcePath),
    [
      "channel-extras.css",
      "generated/raft-icons.svg",
      "generated/raft-official-overlays.css",
      "generated/raft-official-tokens.css",
      "styles.css",
      "tokens.brutal.css",
      "vendor/raft/fonts/raft-quote-glyphs.woff2",
    ],
  );

  const snapshotFiles = new Map(
    snapshot.files.map((entry) => [entry.path, entry]),
  );
  for (const entry of generated.files) {
    assert.doesNotMatch(entry.sourcePath, /\.(?:html|js)$/);
    assert.equal(entry.sha256, snapshotFiles.get(entry.sourcePath)?.sha256);
    const content = readFileSync(
      join(packageRoot, "generated", entry.outputPath),
    );
    assert.equal(content.byteLength, entry.bytes);
    assert.equal(
      createHash("sha256").update(content).digest("hex"),
      entry.sha256,
    );
  }

  const packageJson = readFileSync(join(packageRoot, "package.json"), "utf8");
  assert.doesNotMatch(packageJson, /raft-ui-snapshot/);
});
