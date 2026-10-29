import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const read = (p) => readFileSync("frontends/raft/" + p, "utf8");
test("shared manual menu rows and marked-unread marker come from the reviewed current official declarations", () => {
  assert.match(
    read("packages/web/src/components/ui/MenuItem.tsx"),
    /OfficialContextMenu138/,
  );
  assert.match(read("loom/ActivityContextMenu.tsx"), /<MenuItem/);
  assert.doesNotMatch(read("loom/ActivityContextMenu.tsx"), /const itemClass/);
  assert.match(read("loom/ActivityMessageRow.tsx"), /OfficialMarkedUnread/);
});
test("narrow thread cover uses official tabs and preserves the mounted main and thread surfaces", () => {
  assert.match(read("loom/ChannelApp.tsx"), /useThreadCover/);
  assert.match(read("loom/ThreadWorkspace.tsx"), /coverHeader/);
  assert.match(
    read("loom/OfficialThreadCover138.generated.js"),
    /thread-cover-tabs/,
  );
  assert.doesNotMatch(
    read("loom/OfficialThreadCover138.generated.js"),
    /i8\(|Y6\(|i8.setState/,
  );
});
test("sidebar shared actions retain native leading icons and group separators", () => {
  const menu = read("loom/SidebarMenus.tsx"),
    sidebar = read("loom/ChannelSidebar.tsx");
  assert.match(menu, /ContextMenuSeparator/);
  assert.match(menu, /item.icon/);
  assert.match(sidebar, /icon: <FolderInput/);
  assert.match(sidebar, /<PinOff/);
  assert.match(sidebar, /separatorBefore: true/);
  assert.match(sidebar, /label: "归档",\s*icon: <Archive/);
});

test("menu and cover declaration/type outputs reproduce from verified resource bodies", async () => {
  const gen = await import("./generate-remaining138.mjs");
  const clipboard = await import("./generate-refresh138.mjs");
  for (const [file, text] of [
    ["OfficialContextMenu138.generated.js", gen.generateContext138()],
    ["OfficialContextMenu138.generated.d.ts", gen.context138Types()],
    ["OfficialThreadCover138.generated.js", gen.generateThreadCover138()],
    ["OfficialThreadCover138.generated.d.ts", gen.threadCover138Types()],
    ["OfficialClipboard138.generated.js", clipboard.generateClipboard138()],
    ["OfficialClipboard138.generated.d.ts", clipboard.clipboard138Types()],
  ])
    assert.equal(read("loom/" + file), text);
});
test("saved and message context menus expose native copy actions over Loom-local links", () => {
  assert.match(read("loom/SavedPanel.tsx"), /saved.copyLink/);
  assert.match(read("loom/SavedPanel.tsx"), /saved.copyMarkdown/);
  assert.match(
    read("loom/OfficialMessageItem.generated.tsx"),
    /LoomMessageCopyItems/,
  );
  assert.match(
    read("loom/OfficialThreadPanel.generated.tsx"),
    /mentionComposerChannelId=\{`loom-thread:/,
  );
  assert.match(
    read("loom/OfficialMessageItem.generated.tsx"),
    /if \(mentionComposerChannelId\) return mentionComposerChannelId/,
  );
});
test("supplementary Saved/search menu evidence retains original published excerpt hashes", () => {
  const proof = JSON.parse(
    read("upstream/published-2026-10-29-closeout/menu-audit-sources.json"),
  );
  assert.equal(proof.webVersion, "1.21.38");
  assert.deepEqual(
    proof.resources.map((r) => r.name),
    ["saved", "search"],
  );
  for (const resource of proof.resources) {
    assert.equal(
      createHash("sha256").update(resource.code).digest("hex"),
      resource.excerptSha256,
    );
    assert.match(resource.resourceSha256, /^[a-f0-9]{64}$/);
    assert.ok(resource.url.startsWith("https://app.raft.build/assets/"));
  }
});
