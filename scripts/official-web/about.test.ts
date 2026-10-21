import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractSettingsSections } from "./generate-settings-sections.mjs";
test("About selects native version section and renames product without cloud controls", () => {
  const source = readFileSync(
    "frontends/raft/upstream/raft-web-source/packages/web/src/components/settings/SettingsPanel.tsx",
    "utf8",
  );
  const result = extractSettingsSections(source).about;
  assert.ok(
    result.includes(
      'SurfaceListItem interactive={false} className="space-y-1"',
    ),
  );
  assert.ok(result.includes(">Loom</div>"));
  assert.ok(result.includes("{appVersion}"));
  assert.ok(result.includes('className="space-y-6"'));
  assert.ok(result.includes('className="space-y-3"'));
  assert.ok(result.includes("text-subhead font-semibold text-foreground"));
  assert.ok(result.includes("font-mono text-mono-meta"));
  assert.ok(!result.includes("mobileApp"));
  assert.ok(!result.includes("Feedback"));
  assert.throws(() => extractSettingsSections("changed source"));
});
