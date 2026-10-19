import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/" + p, "utf8");
test("shared header uses native semantic tones without retired theme overrides", () => {
  const s = read("packages/web/src/components/ui/PanelHeader.tsx");
  assert.match(s, /iconTone\?: "location" \| "neutral"/);
  assert.match(s, /iconTone = "neutral"/);
  assert.match(
    s,
    /border-transparent bg-fill-muted text-foreground-muted ring-0/,
  );
  assert.doesNotMatch(s, /theme=elegant|iconBg/);
  assert.match(s, /PROFILE_HANDLE_SIZE_CLASS = "font-mono"/);
});
test("product calls use location for conversation, neutral for computer and no saved header icon", () => {
  assert.match(read("loom/ChannelApp.tsx"), /iconTone="location"/);
  assert.match(read("loom/ComputersPage.tsx"), /iconTone="neutral"/);
  const s = read("loom/SavedPanel.tsx");
  assert.match(s, /flex min-h-0 flex-1 flex-col bg-layer-panel/);
  const header = s.slice(
    s.indexOf("<PanelHeader"),
    s.indexOf("/>", s.indexOf("<PanelHeader")),
  );
  assert.doesNotMatch(header, /icon=|iconBg|iconTone/);
});
test("saved list ports the complete native flat-row composition", () => {
  const s = read("loom/SavedPanel.tsx");
  assert.match(s, /data-saved-row=""/);
  assert.match(s, /before:left-4/);
  assert.match(s, /bg-layer-panel py-1 safe-bottom/);
  assert.match(s, /line-clamp-3 text-callout text-foreground/);
  assert.doesNotMatch(s, /<Card|bg-layer-canvas-muted|flex flex-col gap-2/);
});
