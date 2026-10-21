import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { extractSettingsSections } from "./generate-settings-sections.mjs";
const source = readFileSync(
  new URL(
    "../../frontends/raft/upstream/raft-web-source/packages/web/src/components/settings/SettingsPanel.tsx",
    import.meta.url,
  ),
  "utf8",
);
test("System channel settings preserve the official form and fail on source drift", () => {
  const output = extractSettingsSections(source).system;
  const start = source.indexOf("function SystemChannelsSection() {");
  const renderStart = source.indexOf('<div className="mb-6">', start);
  const renderEnd = source.indexOf("\n  );", renderStart);
  assert.equal(output, source.slice(renderStart, renderEnd).trim());
  assert.throws(() =>
    extractSettingsSections(
      source.replace(
        "function SystemChannelsSection()",
        "function ChangedSection()",
      ),
    ),
  );
});
