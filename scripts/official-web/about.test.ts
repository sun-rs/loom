import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { exposeAboutVersion } from "../../frontends/raft/loom/about-adaptation.ts";
test("About selects native version section and renames product without cloud controls", () => {
  const source = readFileSync(
    "frontends/raft/packages/web/src/components/settings/SettingsPanel.tsx",
    "utf8",
  );
  const result = exposeAboutVersion(source).split(
    "export function LoomAboutSection",
  )[1];
  assert.ok(
    result.includes(
      'SurfaceListItem interactive={false} className="space-y-1"',
    ),
  );
  assert.ok(result.includes(">Loom</div>"));
  assert.ok(result.includes("{appVersion}"));
  assert.ok(!result.includes("mobileApp"));
  assert.ok(!result.includes("Feedback"));
  assert.throws(() => exposeAboutVersion("changed source"));
});
