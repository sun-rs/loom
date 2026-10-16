import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { adaptSystemSettings } from "../../frontends/raft/loom/system-settings-adaptation.ts";
const source = readFileSync(
  new URL(
    "../../frontends/raft/packages/web/src/components/settings/SettingsPanel.tsx",
    import.meta.url,
  ),
  "utf8",
);
test("System channel settings preserve the official form and fail on source drift", () => {
  const output = adaptSystemSettings(source);
  const start = source.indexOf("function SystemChannelsSection() {");
  const render = source.slice(
    source.indexOf("\n  return (", start),
    source.indexOf("\nfunction ServerTranslationSection", start),
  );
  assert.ok(output.includes(render));
  assert.ok(output.includes("useSystemSettings()"));
  assert.throws(() =>
    adaptSystemSettings(
      source.replace("await hideAllChannel();", "await other();"),
    ),
  );
});
