import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  scopedSearchLabel,
  searchEverywhereParams,
  isScopedSearchIdle,
} from "../../frontends/raft/loom/scoped-search.ts";
const read = (p: string) => readFileSync("frontends/raft/" + p, "utf8");
test("scope label uses authorized display title, never falls back to opaque room id", () => {
  assert.equal(
    scopedSearchLabel("r", [
      { channelId: "r", type: "channel", title: "设计" },
    ]),
    "#设计",
  );
  assert.equal(
    scopedSearchLabel("r", [{ channelId: "r", type: "agentDm", title: "Tom" }]),
    "@Tom",
  );
  assert.equal(scopedSearchLabel("secret", []), "此对话");
});
test("everywhere keeps query but removes filters and detail; does not mutate prior route", () => {
  const before = new URLSearchParams(
    "view=search&q=hello&channelId=r&senderId=a&scope=thread&room=r&thread=t&message=m&range=7d",
  );
  const after = searchEverywhereParams(before);
  assert.equal(after.get("q"), "hello");
  assert.equal(after.get("view"), "search");
  for (const key of [
    "channelId",
    "senderId",
    "scope",
    "room",
    "thread",
    "message",
    "range",
  ])
    assert.equal(after.has(key), false);
  assert.equal(before.get("channelId"), "r");
});
test("scope-only empty query displays prompt without history fetch; explicit filters still search", () => {
  assert.equal(isScopedSearchIdle("r", "", {}), true);
  assert.equal(isScopedSearchIdle("r", "word", {}), false);
  assert.equal(isScopedSearchIdle("r", "", { senderIds: ["p"] }), false);
  assert.equal(isScopedSearchIdle(undefined, "", {}), false);
});
test("task view placement follows task container, not viewport", () => {
  assert.match(
    read("loom/OfficialTaskSurfaces.generated.tsx"),
    /@min-md\/tasks:ml-auto/,
  );
  assert.doesNotMatch(
    read("loom/OfficialTaskSurfaces.generated.tsx"),
    /className="sm:ml-auto"/,
  );
});
test("computer lower detail uses a single native spacing owner", () => {
  const s = read("loom/ComputersPage.tsx");
  assert.match(s, /<OfficialComputerSections>/);
  assert.match(s, /<section data-testid="computer-instances">/);
});
test("channel settings keeps drawer branch with native body and actions, not panel inline-save branch", () => {
  const s = read("loom/ChannelSettingsContent.tsx");
  assert.match(s, /<DrawerBody className="min-h-0 flex-1 overflow-y-auto">/);
  assert.match(s, /<DrawerActions>/);
  assert.doesNotMatch(s, /space-y-5 px-4/);
  assert.match(s, /form="loom-channel-settings-form"/);
});
test("scope UI participates in keyboard rail and suppresses unrelated global entity results", () => {
  const s = read("loom/DiscoveryPage.tsx");
  assert.match(s, /<OfficialScopedSearchEntry/);
  assert.match(s, /<OfficialScopedSearchEmpty/);
  assert.match(s, /id: "\$everywhere"/);
  assert.match(s, /else if \("everywhere" in row\)/);
  assert.match(
    s,
    /const searchEntities = scopedConversation \? \[\] : entities.results/,
  );
  assert.match(s, /if \(scopedIdle\)/);
});
test("everywhere native row exposes rail identity and selected prop for keyboard focus", () => {
  const s = read("loom/OfficialScopedSearch.generated.tsx");
  assert.match(s, /data-search-rail-id="\$everywhere"/);
  assert.match(s, /selected=\{selected\}/);
});
test("member strip cancels only its own inline padding inside native DrawerBody", () => {
  const s = read("loom/ChannelMembers.tsx");
  assert.match(
    s,
    /<div className="-mx-4" data-testid="channel-member-strip-inset">\s*<MembersStrip/,
  );
});
test("channel search entry routes to current room scope through guarded navigation", () => {
  const s = read("loom/ChannelApp.tsx");
  const start = s.indexOf('testId="channel-topbar-search"');
  const end = s.indexOf("{controlRoomId", start);
  const entry = s.slice(start, end);
  assert.match(entry, /hasUnresolvedIntents/);
  assert.match(entry, /setPanelParams/);
  assert.match(entry, /channelId: channel.roomId/);
  assert.match(entry, /presentation: "page"/);
  assert.doesNotMatch(entry, /dispatchEvent/);
});
test("scoped search Back retains the originating conversation and accurate accessible label", () => {
  assert.match(
    read("loom/ChannelApp.tsx"),
    /destination === "search" &&\s*params.get\("channelId"\)/,
  );
  assert.match(
    read("loom/SearchHeader.tsx"),
    /conversation \? `返回\$\{conversation\}`/,
  );
});
