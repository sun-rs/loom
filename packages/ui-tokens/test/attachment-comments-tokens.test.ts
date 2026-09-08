import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
const root = fileURLToPath(new URL("../../../", import.meta.url));
test("attachment comments use the authorized Raft stone token and scoped flash timing", () => {
  const source = readFileSync(
    root + "/docs/evidence/raft-web-20260908-current/index-D8Neh8lc.css",
  );
  assert.equal(
    source
      .subarray(4894, 4894 + Buffer.byteLength("--color-brutal-stone:#c0b9b1;"))
      .toString(),
    "--color-brutal-stone:#c0b9b1;",
  );
  const tokens = readFileSync(
    root + "/packages/ui-tokens/src/neo-brutalist/tokens.brutal.css",
    "utf8",
  );
  assert.match(tokens, /--attachment-comment-stone:\s*#c0b9b1;/u);
  const css = readFileSync(
    root + "/apps/web/src/attachment-comments.css",
    "utf8",
  );
  assert.equal(
    (css.match(/var\(--attachment-comment-stone\)/gu) ?? []).length,
    2,
  );
  assert.match(css, /animation:\s*1\.6s ease-out rah-anchor-flash/u);
  assert.match(css, /background-color:\s*var\(--yellow\)/u);
  assert.match(css, /width:\s*320px/u);
});
