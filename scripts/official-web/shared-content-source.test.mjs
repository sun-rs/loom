import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  generateSharedContent,
  sharedContentModules,
} from "./generate-shared-content.mjs";
const read = (p) => readFileSync(p, "utf8");
test("shared content module bodies are reproducible import-only official bindings", () => {
  for (const [name, source] of Object.entries(generateSharedContent()))
    assert.equal(read("frontends/raft/loom/" + name), source);
  for (const name of sharedContentModules) {
    const bridge = read(
      "frontends/raft/packages/web/src/components/" + name + ".tsx",
    );
    assert.match(bridge, /loom\/Official/);
    assert.doesNotMatch(bridge, /className=|useState|bg-|border-/);
  }
  const markdown = read(
    "frontends/raft/loom/OfficialMarkdownContent.generated.tsx",
  );
  assert.match(markdown, /bg-layer-code px-3 py-2/);
  assert.match(markdown, /border-line-seam pl-2.5/);
  assert.match(markdown, /bg-fill-muted/);
  assert.match(
    read("frontends/raft/loom/OfficialCopyIconButton.generated.tsx"),
    /focus-visible:shadow-focus/,
  );
});
