import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readUiSource as read } from "./ui-source.ts";
test("three panel handles share one event implementation and keep width policy owners", () => {
  for (const panel of ["room-sidebar", "thread-panel", "profile-panel"]) {
    const wrapper = read(`components/${panel}-resizer.tsx`);
    assert.match(wrapper, /<PanelResizer/);
    assert.doesNotMatch(wrapper, /onPointer|onKeyDown|useRef|localStorage/);
    assert.match(wrapper, new RegExp(`${panel}-resize.ts`));
  }
  const shared = read("components/panel-resizer.tsx");
  assert.match(shared, /onLostPointerCapture=\{finish\}/);
  assert.match(shared, /onPointerCancel=\{finish\}/);
  assert.match(shared, /onPointerUp=\{finish\}/);
  assert.doesNotMatch(shared, /client-sdk|client-core|localStorage|fetch\(/);
});

test("migrated geometry cannot be redefined in former page owners", () => {
  for (const file of [
    "product.css",
    "identity-interactions.css",
    "agent-directory.css",
  ]) {
    const css = read(file);
    assert.doesNotMatch(css, /\.rah-panel-header-action[^{}]*\{/);
    assert.doesNotMatch(css, /\.rah-agent-head-actions \.sq-btn[^{}]*\{/);
    for (const rule of css.matchAll(
      /\.(?:rah-room-sidebar-resizer|rah-thread-resizer|rah-agent-profile-resizer)[^{}]*\{([^}]*)\}/g,
    )) {
      assert.doesNotMatch(
        rule[1]!,
        /(?:^|;)\s*(?:width|background|cursor|outline|touch-action|user-select|top|bottom)\s*:/,
      );
    }
  }
});

test("production and browser fixture consume the same stylesheet entry", () => {
  assert.match(read("main.tsx"), /import "\.\/product-styles.ts"/);
  const fixture = readFileSync(
    new URL("ui-foundations.tsx", import.meta.url),
    "utf8",
  );
  assert.match(fixture, /import "\.\.\/src\/product-styles.ts"/);
  assert.doesNotMatch(fixture, /import .*\.css/);
  assert.match(
    read("product-styles.ts"),
    /@rah-os\/ui-tokens\/neo-brutalist\.css/,
  );
  assert.doesNotMatch(read("main.tsx"), /ui-foundations/);
});

test("conversation header and Tabs have one presentation/event owner", () => {
  for (const file of [
    "workspace-navigation",
    "agent-directory-pane",
    "conversation-panes",
  ]) {
    assert.match(read(`components/${file}.tsx`), /<PanelHeader kind=/);
  }
  assert.match(read("App.tsx"), /<ConversationTabs/);
  assert.doesNotMatch(read("App.tsx"), /<TabButton|role="tablist"/);
  const agent = read("components/agent-directory-pane.tsx");
  assert.match(agent, /<PanelTabs/);
  assert.doesNotMatch(agent, /onTabKeyDown|role="tablist"/);
  for (const file of [
    "product.css",
    "chat-surface.css",
    "agent-directory.css",
    "identity-interactions.css",
  ]) {
    assert.doesNotMatch(
      read(file),
      /\.(?:channel-head|thread-head|rah-agent-detail-head|rah-agent-tabs-frame|rah-panel-tabs|rah-panel-header)\s*(?:::?[\w-]+)?\s*\{/,
    );
  }
  assert.doesNotMatch(
    read("components/panel-tabs.tsx"),
    /fetch\(|client-sdk|client-core|localStorage|\.scrollIntoView\(/,
  );
  const source = readFileSync(
    new URL(
      "../../../docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.ok(
    source.includes("enableHomeAndEndKeys:!0,loopFocus:s,orientation:p"),
  );
  assert.ok(source.includes("disabledIndices:tu"));
});

test("surface and sidebar headers consume the same track and identity slot", () => {
  assert.doesNotMatch(read("product.css"), /--head-h:\s*48px/);
  assert.match(
    read("panel-layout.css"),
    /@media \(max-height: 600px\)[\s\S]*--head-h:\s*48px/,
  );
  for (const file of [
    "settings-primitives",
    "settings-surface",
    "workspace-catalog-panes",
    "global-discovery",
  ])
    assert.match(read(`components/${file}.tsx`), /<PanelHeader\s/);
  for (const file of [
    "settings-primitives",
    "workspace-catalog-panes",
    "global-discovery",
    "workspace-navigation",
  ])
    assert.match(read(`components/${file}.tsx`), /<PanelHeaderIcon\s/);
  for (const file of [
    "product.css",
    "computer-directory.css",
    "agent-directory.css",
  ])
    assert.doesNotMatch(
      read(file),
      /--rah-settings-header-height|height:\s*var\(--raft-(?:computers|members)-(?:sidebar|detail)-header-height\)/,
    );
  assert.doesNotMatch(
    read("product.css"),
    /\.rah-settings-mobile-back > svg\s*\{/,
  );
});

test("back actions use the official arrow glyph, not a rotated chevron alias", () => {
  assert.doesNotMatch(
    read("components/icon.tsx"),
    /"arrow-left":\s*"chevron-right"/,
  );
  const sprite = readFileSync(
    "packages/ui-tokens/src/interaction-icons.svg",
    "utf8",
  );
  assert.match(sprite, /id="raft-icon-arrow-left"/);
  assert.match(sprite, /d="m12 19-7-7 7-7"/);
  assert.match(sprite, /d="M19 12H5"/);
});

test("Saved and Search use shared headers and remove page-owned track/icon geometry", () => {
  const saved = read("components/saved-messages.tsx");
  const search = read("components/global-discovery.tsx");
  assert.match(
    saved,
    /<PanelHeader kind="surface" className="rah-saved-header"/,
  );
  assert.match(saved, /<PanelHeaderIcon name="bookmark"/);
  assert.match(search, /<PanelHeader kind="surface" className="search-top"/);
  assert.match(search, /<PanelHeaderIcon name="search"/);
  assert.match(search, /aria-label="返回聊天"/);
  assert.match(search, /aria-label="清除搜索"/);
  assert.doesNotMatch(
    read("message-social.css"),
    /\.rah-saved-header(?:-icon)?(?: svg)?\s*\{/,
  );
  assert.doesNotMatch(
    readFileSync("packages/ui-tokens/src/neo-brutalist/search.css", "utf8"),
    /\.(?:search-top|search-icon-box)(?: svg)?\s*\{/,
  );
});
