import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateRegion } from "./generate-region.mjs";
test("date/time presentation equals pinned official JSX with explicit local persistence binding", () => {
  assert.equal(
    readFileSync("frontends/raft/loom/OfficialDateTime.generated.tsx", "utf8"),
    generateRegion(),
  );
  const binding = readFileSync(
    "frontends/raft/loom/LanguageRegionSettings.tsx",
    "utf8",
  );
  assert.match(binding, /<OfficialDateTime/);
  assert.doesNotMatch(
    binding,
    /settings.dateTime.timezoneDesc|<SegmentedControl/,
  );
  assert.match(binding, /saveDeviceRegion/);
});
