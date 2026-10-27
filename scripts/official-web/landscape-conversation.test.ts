import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compactConversationRoute } from "../../frontends/raft/loom/adaptive-layout.ts";
test("only a resolved primary conversation may consolidate touch landscape chrome", () => {
  assert.equal(
    compactConversationRoute(new URLSearchParams("room=a"), true),
    true,
  );
  assert.equal(
    compactConversationRoute(new URLSearchParams("room=a"), false),
    false,
  );
  for (const query of [
    "view=activity&room=a",
    "chat=list&room=a",
    "saved=1&room=a",
    "room=a&thread=b",
    "room=a&side=b",
  ])
    assert.equal(
      compactConversationRoute(new URLSearchParams(query), true),
      false,
      query,
    );
});
test("consolidation keeps notification and search, scopes touch landscape, never changes typography", () => {
  const css = readFileSync("frontends/raft/loom/mobile.css", "utf8");
  const section = css.split(
    "/* Loom touch landscape conversation chrome */",
  )[1];
  assert.ok(section);
  assert.match(section, /pointer: coarse/);
  assert.match(section, /min-width: 840px/);
  assert.match(section, /orientation: landscape/);
  assert.match(section, /data-testid="app-top-bar"/);
  assert.match(section, /loom-conversation-notifications/);
  assert.doesNotMatch(section, /font|line-height|zoom|transform/);
  const app = readFileSync("frontends/raft/loom/ChannelApp.tsx", "utf8");
  assert.match(app, /data-compact-conversation=/);
  assert.match(app, /className="loom-conversation-notifications"/);
  assert.match(app, /testId="channel-topbar-search"/);
  const bar = readFileSync("frontends/raft/loom/TopBar.tsx", "utf8");
  assert.match(bar, /if \(r.width === 0\)/);
});
