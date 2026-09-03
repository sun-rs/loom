import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const packageRoot = join(import.meta.dirname, "..");
const repositoryRoot = join(packageRoot, "..", "..");

test("interaction icon geometry is frozen from Raft RFe/TFe/yze/cze/Bw, Agent tabs, profile, and Reminder live DOM", () => {
  const content = readFileSync(
    join(packageRoot, "src", "interaction-icons.svg"),
  );
  const source = content.toString("utf8");
  for (const exactRaftPath of [
    'd="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"',
    'd="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"',
    'd="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0',
    'd="M16 12h2"',
    'd="M12 6v6h4"',
    'd="m17 2 4 4-4 4"',
    'd="M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742"',
  ]) {
    assert.match(
      source,
      new RegExp(exactRaftPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"),
    );
  }
  assert.doesNotMatch(
    source,
    /raft-icon-shield-check[^<]*>[\s\S]*?m9 12 2 2 4-4/u,
  );
  assert.equal(
    createHash("sha256").update(content).digest("hex"),
    "f1a811d309f01a77444817cfdecd07466e69bd9bb4999ac438efe9ea6029805d",
  );
});
test("quick-reaction sprite is the unchanged official published asset", () => {
  const content = readFileSync(
    join(repositoryRoot, "apps/web/src/raft-reaction-sprite.svg"),
  );
  assert.equal(
    createHash("sha256").update(content).digest("hex"),
    "10912fdacbbfc427fcd1cdd0bc8ad7a2fc0a40fa121ee663f0a8ad19c67499f8",
  );
});

test("additional discovery icons retain the paths extracted from the Raft published bundle", () => {
  const content = readFileSync(join(packageRoot, "src", "discovery-icons.svg"));
  assert.equal(
    createHash("sha256").update(content).digest("hex"),
    "c53661c37138cd8c07b6648a7ec7f80c6a9c0953e0f609917be0ba17ed90aeec",
  );
});

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
      "activity.css",
      "channel-extras.css",
      "generated/raft-icons.svg",
      "generated/raft-official-activity.css",
      "generated/raft-official-avatar-pack.json",
      "generated/raft-official-computers.css",
      "generated/raft-official-members-page.css",
      "generated/raft-official-overlays.css",
      "generated/raft-official-tasks.css",
      "generated/raft-official-tokens.css",
      "search.css",
      "styles.css",
      "tokens.brutal.css",
      "vendor/raft/fonts/raft-quote-glyphs.woff2",
      "vendor/raft/fonts/space-grotesk-latin.woff2",
      "vendor/raft/fonts/space-mono-400-latin.woff2",
      "vendor/raft/fonts/space-mono-700-latin.woff2",
      "vendor/raft/official-fonts.css",
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
  assert.match(packageJson, /"\.\/official-fonts\.css"/u);
});

test("official Raft font mirrors are byte-exact and expose the message reaction metrics", () => {
  for (const [relativePath, expectedSha256] of [
    [
      "vendor/raft/official-fonts.css",
      "01e31b4f1fb7f6623acbd928a2ae50e29011b26121e6ea39fdc0241f7ac50ad7",
    ],
    [
      "vendor/raft/fonts/space-grotesk-latin.woff2",
      "a0d054c4af557de20afd6ca59f47ab353bcaec49c63ff04b6c9d39d0f8910557",
    ],
    [
      "vendor/raft/fonts/space-mono-400-latin.woff2",
      "e0c8e616bda27642f4c3cebaecff6525d901e73afc8a227cbbb0f2af4810f300",
    ],
    [
      "vendor/raft/fonts/space-mono-700-latin.woff2",
      "af7cf6d2b897ec453acdcdacde4e9bcc8410718af5914de865b453e09f10eebc",
    ],
  ] as const) {
    const content = readFileSync(join(packageRoot, "generated", relativePath));
    assert.equal(
      createHash("sha256").update(content).digest("hex"),
      expectedSha256,
    );
  }
});
