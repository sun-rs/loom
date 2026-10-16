import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { adaptArchivedChannels } from "../../frontends/raft/loom/settings-archive-adaptation.ts";
const source = readFileSync(
  new URL(
    "../../frontends/raft/packages/web/src/components/settings/ArchivedChannelsSection.tsx",
    import.meta.url,
  ),
  "utf8",
);
test("Archived settings keep official section markup, row/button composition and scoped controller", () => {
  const output = adaptArchivedChannels(source);
  const render = source.slice(
    source.indexOf("  return (\n    <section"),
    source.indexOf("\nexport default"),
  );
  assert.ok(
    output.includes(
      render.replace(
        "formatMessage({ id: channelTypeMessageId(channel.type) })",
        '"频道"',
      ),
    ),
  );
  assert.ok(output.includes("useArchivedSettings()"));
  assert.ok(!output.includes("await unarchiveChannel(channel.id)"));
  assert.throws(() =>
    adaptArchivedChannels(
      source.replace("await unarchiveChannel(channel.id);", "await other();"),
    ),
  );
});
