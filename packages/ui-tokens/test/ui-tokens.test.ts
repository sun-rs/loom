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
    'd="m12 19-7-7 7-7"',
    'd="M19 12H5"',
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
    // Keep the entire prior sprite byte-frozen while adopting one verified
    // arrow-left symbol. Never promote a new whole-file hash to hide drift.
    createHash("sha256")
      .update(
        source.replace(
          /  <!-- Raft live channel\/settings\/computer mobile back, index-Biin3FEA\.js,[\s\S]*?<symbol id="raft-icon-arrow-left"[\s\S]*?<\/symbol>\n/u,
          "",
        ),
      )
      .digest("hex"),
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

test("adopted assets retain origin evidence without requiring mutable CSS to stay frozen", () => {
  const adoption = JSON.parse(
    readFileSync(join(packageRoot, "adoption.json"), "utf8"),
  );
  const snapshot = JSON.parse(
    readFileSync(join(repositoryRoot, adoption.originManifest), "utf8"),
  );
  assert.equal(adoption.files.length, 18);
  assert.deepEqual(adoption.source, snapshot.source);
  for (const entry of adoption.files) {
    assert.doesNotMatch(entry.path, /\.(?:html|js)$/);
    assert.equal(
      entry.originSha256,
      snapshot.files.find(
        (source: { path: string }) => source.path === entry.originPath,
      )?.sha256,
    );
    if (entry.policy === "immutable-asset") {
      assert.equal(
        createHash("sha256")
          .update(readFileSync(join(repositoryRoot, entry.path)))
          .digest("hex"),
        entry.originSha256,
      );
    }
  }
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
    const content = readFileSync(
      join(packageRoot, "src/neo-brutalist", relativePath),
    );
    assert.equal(
      createHash("sha256").update(content).digest("hex"),
      expectedSha256,
    );
  }
});
