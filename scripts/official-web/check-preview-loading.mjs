import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
const root = "frontends/raft/packages/web/dist-workbench/";
const manifest = JSON.parse(readFileSync(root + ".vite/manifest.json", "utf8"));
const initial = new Set();
function visit(key) {
  if (initial.has(key)) return;
  initial.add(key);
  for (const key2 of manifest[key].imports ?? []) visit(key2);
}
visit("index.html");
visit("../../loom/app-entry.tsx");
for (const key of [
  "../../loom/DocumentPreview.tsx",
  "../../loom/HtmlPreview.tsx",
  "src/components/ImageLightbox.tsx",
]) {
  assert.ok(
    manifest[key]?.isDynamicEntry,
    key + " must remain a deferred entry",
  );
  assert.equal(initial.has(key), false, key + " leaked into startup");
}
assert.ok(
  ![...initial].some((key) => /attachmentPreviewSurfaces/i.test(key)),
  "preview surface leaked into startup",
);
const bodies = [...initial].map((key) =>
  readFileSync(root + manifest[key].file),
);
console.log(
  JSON.stringify({
    initialJsChunks: initial.size,
    decodedBytes: bodies.reduce((n, b) => n + b.length, 0),
    comparableGzipBytes: bodies.reduce((n, b) => n + gzipSync(b).length, 0),
    previewHostsDeferred: true,
  }),
);
