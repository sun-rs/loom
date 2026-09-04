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
