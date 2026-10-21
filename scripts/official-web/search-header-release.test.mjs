import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("search field retains native leading addon, clear control and shared full-page composition", () => {
  const s = readFileSync(
    "frontends/raft/loom/OfficialSearchControls.generated.tsx",
    "utf8",
  );
  assert.match(s, /<InputGroupAddon align="inline-start">/);
  assert.match(s, /size="icon-sm"/);
  assert.match(s, /<X aria-hidden size=\{18\}/);
  assert.match(s, /<Kbd className="hidden sm:inline-flex">/);
  assert.match(
    s,
    /flex shrink-0 items-center border-b border-line-seam px-3 py-3/,
  );
  assert.doesNotMatch(s, /size-icon-header|text-\[10px\]|icon-xs|py-2\.5/);
});
test("shared header uses native status slot and back icon size", () => {
  const s = readFileSync(
    "frontends/raft/upstream/raft-web-source/packages/web/src/components/ui/PanelHeader.tsx",
    "utf8",
  );
  assert.match(s, /<PanelStatus>{titleSuffix}<\/PanelStatus>/);
  assert.match(s, /<ArrowLeft size=\{22\}/);
});
