import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
test("theme option and preview retain recorded official bodies and one runtime", () => {
  const root = "frontends/raft/upstream/published-2026-10-26/";
  const source = readFileSync(root + "theme-option.js", "utf8");
  const manifest = JSON.parse(readFileSync(root + "manifest.json", "utf8"));
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    manifest.themeOption.extractedSha256,
  );
  assert.match(source, /from "raft-ui"/);
  assert.doesNotMatch(source, /vendor-raft-ui|app-shell-/);
});
test("workspace theme uses canonical persisted preferences and official stylesheet, independently from device mode", () => {
  const component = readFileSync(
    "frontends/raft/loom/WorkspaceTheme.tsx",
    "utf8",
  );
  assert.match(component, /useSidebarPreferences/);
  assert.match(component, /data-theme-decor/);
  assert.doesNotMatch(component, /localStorage/);
  assert.match(
    readFileSync("frontends/raft/packages/web/src/index.css", "utf8"),
    /raft-ui\/themes.css/,
  );
  assert.doesNotMatch(
    readFileSync(
      "frontends/raft/packages/web/src/theme/AppThemeProvider.tsx",
      "utf8",
    ),
    /removeAttribute\("data-theme"\)/,
  );
});
