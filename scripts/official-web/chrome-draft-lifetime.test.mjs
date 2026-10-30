import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("device mode does not overwrite canonical frame chrome with canvas color", () => {
  const mode = readFileSync(
    "frontends/raft/packages/web/src/theme/AppThemeProvider.tsx",
    "utf8",
  );
  assert.doesNotMatch(mode, /theme-color|--layer-canvas/);
  const frame = readFileSync("frontends/raft/loom/WorkspaceTheme.tsx", "utf8");
  assert.match(frame, /theme-color/);
  assert.match(frame, /resolveBrowserChromeColor\(\s*"frame"/);
});
test("PWA underlay and safe top use the same frame token without changing page geometry", () => {
  const css = readFileSync("frontends/raft/loom/mobile.css", "utf8");
  assert.match(css, /@media \(display-mode: standalone\)/);
  assert.match(
    css,
    /background-image:\s*linear-gradient\(var\(--layer-frame\), var\(--layer-frame\)\)/,
  );
  assert.match(css, /background-size:\s*100% env\(safe-area-inset-top, 0px\)/);
});
