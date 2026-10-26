import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("current official list width preserves the main column and caps activity with selection at half", async () => {
  const { resolveListWidth, LIST_BOUNDS } =
    await import("../../frontends/raft/loom/current-list-layout.ts");
  assert.deepEqual(LIST_BOUNDS, { min: 240, max: 640, defaultWidth: 380 });
  assert.equal(resolveListWidth(380, 1300, false), 380);
  assert.equal(resolveListWidth(640, 1000, true), 500);
  assert.equal(resolveListWidth(640, 800, false), 440);
  // Official policy hides an extra column when all three minima cannot fit.
  assert.equal(resolveListWidth(380, 1000, true, 360), 280);
  assert.equal(resolveListWidth(380, 900, true, 360), 380);
  assert.equal(resolveListWidth(380, 1300, false), 380); // never overwrite a preferred width after narrowing
});
test("desktop activity retains an empty detail while mobile remains a single list", () => {
  const page = readFileSync("frontends/raft/loom/DiscoveryPage.tsx", "utf8");
  assert.match(page, /mode === "activity" && desktop/);
  assert.match(page, /ActivityNothingOpen/);
  assert.match(page, /useCurrentListPanel/);
  assert.doesNotMatch(page, /defaultWidth: 560/);
});
test("memory adopts the same list sizing without replacing ordinary 240px navigation sidebars", () => {
  const memory = readFileSync("frontends/raft/loom/MemoryPage.tsx", "utf8");
  assert.match(memory, /useCurrentListPanel/);
  assert.doesNotMatch(memory, /defaultWidth: 560/);
  for (const name of [
    "ChannelApp",
    "RoleWorkspace",
    "ComputersPage",
    "SettingsPage",
  ]) {
    assert.match(
      readFileSync(`frontends/raft/loom/${name}.tsx`, "utf8"),
      /SIDEBAR_PANEL_BOUNDS/,
    );
  }
});
