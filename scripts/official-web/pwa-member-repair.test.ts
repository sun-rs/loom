import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const read = (name: string) =>
  readFileSync("frontends/raft/loom/" + name, "utf8");
test("browser chrome reuses official six-digit hex conversion, never a raw CSS token", () => {
  assert.match(read("WorkspaceTheme.tsx"), /resolveBrowserChromeColor/);
  assert.doesNotMatch(read("WorkspaceTheme.tsx"), /meta\.content = color/);
  assert.match(
    readFileSync(
      "frontends/raft/packages/web/public/app-theme-bootstrap.js",
      "utf8",
    ),
    /theme-color/,
  );
});
test("a stable PWA top surface is outside changing page bodies and respects only the existing safe inset", () => {
  assert.match(read("ChannelApp.tsx"), /data-testid="pwa-status-bar-surface"/);
  assert.match(read("mobile.css"), /pwa-status-bar-surface/);
});
test("global Tasks retain their page projection while inactive without retaining an interactive hidden page", () => {
  assert.match(read("ChannelApp.tsx"), /tasksVisited/);
  assert.match(read("ChannelApp.tsx"), /data-testid="tasks-route-slot"/);
  assert.match(read("TasksPage.tsx"), /if \(!active\) return/);
  assert.match(read("TasksPage.tsx"), /loadedKey/);
  assert.match(read("TasksPage.tsx"), /TaskLoading/);
  assert.match(read("TaskLoading.tsx"), /TaskLoadingList/);
  assert.doesNotMatch(read("TasksPage.tsx"), /SkeletonRow/);
});
test("all role member candidates carry their current Role revision avatar through native data slots", () => {
  assert.match(
    read("ChannelMembers.tsx"),
    /avatarUrl: r\.configuration\.avatarKey/,
  );
  assert.match(
    read("AddInstanceDialog.tsx"),
    /agentAvatarUrl=\{role\.configuration\.avatarKey\}/,
  );
});
test("native chrome and avatar presentation regenerate from the locked release declarations", async () => {
  const base = "frontends/raft/upstream/published-2026-10-30-pwa140/";
  const lock = JSON.parse(readFileSync(base + "manifest.json", "utf8"));
  assert.equal(lock.release.branch, "release/v1.21.40");
  assert.equal(lock.chromeWasAlreadyPresentInWeb139, true);
  for (const [file, sha] of Object.entries(lock.files))
    assert.equal(
      createHash("sha256")
        .update(readFileSync(base + file))
        .digest("hex"),
      sha,
      file,
    );
  const { generatePwa140 } = await import("./generate-pwa140.mjs");
  for (const [file, source] of Object.entries(generatePwa140()))
    assert.equal(read(file), source);
  assert.match(read("AvatarLibraryPicker.tsx"), /presetButtonClass/);
  assert.match(read("AvatarLibraryPicker.tsx"), /avatarPickerClasses\.grid/);
});
test("official default chrome values are opaque portable hex in both native modes", async () => {
  const { resolveBrowserChromeColor } =
    await import("../../frontends/raft/loom/OfficialPwa140.generated.js");
  const previous = globalThis.document;
  try {
    globalThis.document = {
      documentElement: { dataset: {} },
    } as typeof document;
    assert.equal(resolveBrowserChromeColor("frame", "light"), "#FFD440");
    assert.equal(resolveBrowserChromeColor("frame", "dark"), "#0D0D0B");
  } finally {
    if (previous) globalThis.document = previous;
    else delete globalThis.document;
  }
});
