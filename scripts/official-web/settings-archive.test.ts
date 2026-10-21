import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { generateSettingsFoundation } from "./generate-settings-foundation.mjs";
test("Archive adopts official rows, restore button and visibility rule with local authority", () => {
  const output = generateSettingsFoundation().OfficialArchivedChannels;
  assert.match(output, /useArchivedSettings\(\)/);
  assert.match(
    output,
    /!capabilities.archiveChannels \|\| loading \|\| archivedChannels.length === 0/,
  );
  assert.match(output, /disabled=\{busyChannelId !== null\}/);
  assert.match(output, /const typeLabel = "频道"/);
  assert.doesNotMatch(
    output,
    /useServerStore|useChannelStore|await unarchiveChannel/,
  );
  const source = readFileSync(
    "frontends/raft/upstream/raft-web-source/packages/web/src/components/settings/UnarchiveChannelButton.tsx",
    "utf8",
  );
  assert.ok(
    output.includes(
      source
        .slice(source.indexOf("export function UnarchiveChannelButton"))
        .trim(),
    ),
  );
});
