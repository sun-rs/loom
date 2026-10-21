import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateRelease } from "./generate-release.mjs";
test("release presentation matches official source and removes legacy runtime slicing", () => {
  const generated = readFileSync(
    "frontends/raft/loom/OfficialReleaseNotes.generated.tsx",
    "utf8",
  );
  assert.equal(generated, generateRelease());
  assert.doesNotMatch(generated, /api\.get|useServerStore|<PanelHeader/);
  assert.match(
    generated,
    /releases.find\(\(release\) => release.state === "published"\)/,
  );
  assert.doesNotMatch(
    readFileSync("frontends/raft/loom/vite.config.ts", "utf8"),
    /exposeReleaseNotes|loom-native-release-notes/,
  );
  assert.match(
    readFileSync("frontends/raft/loom/SettingsPage.tsx", "utf8"),
    /OfficialReleaseNotes.generated/,
  );
});
