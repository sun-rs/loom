import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = [
  "room-files.tsx",
  "file-preview-renderers.tsx",
  "html-file-preview.tsx",
]
  .map((name) =>
    readFileSync(
      join(import.meta.dirname, "..", "src", "components", name),
      "utf8",
    ),
  )
  .join("\n");
const css = readFileSync(
  join(import.meta.dirname, "..", "src", "room-files.css"),
  "utf8",
);

test("Raft Files actions and the rich attachment preview share one bounded frame", () => {
  assert.match(
    source,
    /className="sq-btn rah-file-direct-action rah-file-source"/u,
  );
  assert.match(
    source,
    /className="sq-btn rah-file-direct-action rah-file-download"/u,
  );
  assert.match(source, /className="sq-btn rah-file-overflow"/u);
  assert.match(source, /classifyAttachmentPreview/u);
  assert.match(source, /client\.files\s*\.previewText/u);
  assert.match(source, /<MessageMarkdown source=\{text\}/u);
  assert.match(source, /sandbox="allow-scripts"/u);
  assert.doesNotMatch(source, /sandbox="[^"]*allow-same-origin/u);
  assert.match(source, /script-src \$\{url\}/u);
  assert.match(source, /event.source !== element.contentWindow/u);
  assert.match(source, /MAX_RENDERED_PREVIEW_CHARACTERS/u);
  assert.match(source, /MAX_CSV_PREVIEW_ROWS/u);
  assert.match(
    css,
    /@media \(max-width: 767px\)[\s\S]*?\.rah-file-direct-action/u,
  );
  assert.match(css, /\.rah-file-preview-html/u);
  assert.match(css, /\.rah-file-preview-diff-line\.is-addition/u);
});

test("attachment preview escapes the message containment through the shared document overlay root", () => {
  const preview = source.slice(source.indexOf("function FilePreview("));
  assert.match(preview, /return createPortal\(/u);
  assert.match(preview, /<DialogLayer className="rah-dialog-layer">/u);
  assert.match(preview, /document\.body,/u);
  assert.match(preview, /useDialogProtocol/u);
  const interactions = readFileSync(
    join(
      import.meta.dirname,
      "../../../packages/ui-tokens/src/neo-brutalist/interaction-state.css",
    ),
    "utf8",
  );
  assert.match(
    interactions,
    /:where\(\.rah-product-shell, \.rah-dialog-layer\) :where\(button\)/u,
  );
});
