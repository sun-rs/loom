import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  completeComposerMention,
  composerMentionMatch,
  filterComposerMentionAgents,
} from "../src/composer-mention.ts";

const agents = [
  { displayName: "Alice", handle: "alice", participantId: "agent_alice" },
  {
    displayName: "Cindy",
    handle: "onboarding-cindy",
    participantId: "agent_cindy",
  },
];

test("composer detects the active @Agent token without treating an email as a mention", () => {
  assert.deepEqual(composerMentionMatch("请@Ali", 5), {
    end: 5,
    query: "Ali",
    start: 1,
  });
  assert.deepEqual(composerMentionMatch("在 @onboard 后面", 10), {
    end: 10,
    query: "onboard",
    start: 2,
  });
  assert.equal(composerMentionMatch("mail@example.com", 8), undefined);
  assert.equal(composerMentionMatch("@Alice 已选中", 10), undefined);
  assert.equal(composerMentionMatch("`@Ali`", 5), undefined);
  assert.equal(composerMentionMatch("```\n@Ali\n```", 8), undefined);
  assert.equal(composerMentionMatch("https://x.test/@Ali", 19), undefined);
  assert.equal(composerMentionMatch("[@Ali](https://x.test)", 5), undefined);
});

test("composer filters Room Agents and completes only the active token", () => {
  const match = composerMentionMatch("请@onb继续", 5);
  assert.ok(match);
  assert.deepEqual(
    filterComposerMentionAgents(agents, match).map(
      ({ participantId }) => participantId,
    ),
    ["agent_cindy"],
  );
  assert.deepEqual(
    completeComposerMention("请@onb继续", "onboarding-cindy", match),
    { caret: 19, text: "请@onboarding-cindy 继续" },
  );
});

test("Room, DM and Thread reuse the Raft mention menu and its yellow active row", () => {
  const panes = readFileSync(
    new URL("../src/components/conversation-panes.tsx", import.meta.url),
    "utf8",
  );
  const component = readFileSync(
    new URL("../src/components/composer-mention.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(
    new URL(
      "../../../packages/ui-tokens/src/neo-brutalist/choice-row.css",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal(panes.match(/<ComposerMentionMenu/g)?.length, 2);
  assert.match(component, /profile="autocomplete"/u);
  assert.match(component, /current=\{index === activeIndex\}/u);
  assert.match(component, /role="listbox"/u);
  assert.match(component, /<AgentAvatar/u);
  assert.match(panes, /mentionAgentIds/u);
  assert.match(
    css,
    /\[data-choice-profile="autocomplete"\]\[data-choice-current\][^{]*\{\s*background:\s*var\(--yellow\)/u,
  );
});

test("channel completion filters visible channels, retains archived references and inserts at caret", async () => {
  const {
    composerChannelMatch,
    filterComposerChannels,
    completeComposerChannel,
  } = await import("../src/composer-mention.ts");
  const channels = [
    { roomId: "all", name: "all", kind: "channel", description: "General" },
    {
      roomId: "old",
      name: "old-project",
      kind: "channel",
      archivedAt: "2026-09-01",
    },
    { roomId: "dm", name: "private", kind: "direct" },
  ] as const;
  const match = composerChannelMatch("看 #old 后文", 6);
  assert.deepEqual(match, { start: 2, end: 6, query: "old" });
  assert.deepEqual(
    filterComposerChannels(channels, match!).map((x) => x.roomId),
    ["old"],
  );
  assert.deepEqual(
    completeComposerChannel("看 #old 后文", "old-project", match!),
    { text: "看 #old-project 后文", caret: 15 },
  );
  assert.equal(composerChannelMatch("https://example.com/#old", 24), undefined);
  assert.equal(composerChannelMatch("`#old`", 5), undefined);
  assert.equal(composerChannelMatch("#old-project 已完成", 16), undefined);
  assert.equal(
    filterComposerChannels(channels, { start: 0, end: 1, query: "" }).length,
    2,
  );
});

test("Raft mention fields, stable ranking, pinyin and bounded fuzzy matching", () => {
  const rows = [
    {
      participantId: "description",
      handle: "other",
      displayName: "Other",
      description: "parity",
    },
    { participantId: "display", handle: "another", displayName: "Parity" },
    { participantId: "account", handle: "Parity", displayName: "Different" },
    { participantId: "case", handle: "parity", displayName: "Different" },
    { participantId: "prefix", handle: "parity-a", displayName: "Different" },
    { participantId: "zh", handle: "helper", displayName: "李云龙" },
    { participantId: "fuzzy", handle: "abc-def", displayName: "Different" },
    {
      participantId: "far",
      handle: "a123456789b123456789c",
      displayName: "Different",
    },
  ];
  const query = (query: string) =>
    filterComposerMentionAgents(rows, {
      start: 0,
      end: query.length + 1,
      query,
    }).map((x) => x.participantId);
  assert.deepEqual(query("parity"), [
    "account",
    "case",
    "display",
    "description",
    "prefix",
  ]);
  assert.deepEqual(query("liyunlong"), ["zh"]);
  assert.deepEqual(query("lyl"), ["zh"]);
  assert.deepEqual(query("abdf"), ["fuzzy"]);
  assert.ok(!query("abc").includes("far"));
  assert.equal(
    completeComposerMention("@par", "Parity", {
      start: 0,
      end: 4,
      query: "par",
    }).text,
    "@Parity ",
  );
});

test("composer empty queries retain all candidates; nonempty queries cap at 30 for both types", async () => {
  const { filterComposerChannels } = await import("../src/composer-mention.ts");
  const rows = Array.from({ length: 40 }, (_, i) => ({
    participantId: String(i),
    handle: `agent${i}`,
    displayName: `Agent ${i}`,
    roomId: String(i),
    name: `channel${i}`,
    kind: "channel",
    description: "documentation",
  }));
  assert.equal(
    filterComposerMentionAgents(rows, { start: 0, end: 1, query: "" }).length,
    40,
  );
  assert.equal(
    filterComposerMentionAgents(rows, { start: 0, end: 6, query: "agent" })
      .length,
    30,
  );
  assert.equal(
    filterComposerChannels(rows, { start: 0, end: 1, query: "" }).length,
    40,
  );
  assert.equal(
    filterComposerChannels(rows, { start: 0, end: 4, query: "doc" }).length,
    30,
  );
  assert.deepEqual(
    filterComposerChannels(
      [{ roomId: "zh", kind: "channel", name: "研发中心", archivedAt: "old" }],
      { start: 0, end: 5, query: "yfzx" },
    ).map((x) => x.roomId),
    ["zh"],
  );
});

test("thread recent participants precede other ranked candidates without introducing candidates", async () => {
  const { prioritizeComposerParticipants } =
    await import("../src/composer-mention.ts");
  assert.deepEqual(
    prioritizeComposerParticipants(agents, [
      "agent_cindy",
      "outsider",
      "agent_cindy",
      "agent_alice",
    ]).map((x) => x.participantId),
    ["agent_cindy", "agent_alice"],
  );
});

test("word boundaries outrank substring; description does not gain fuzzy-name matching", () => {
  const rows = [
    { participantId: "substring", handle: "xhelper", displayName: "x" },
    { participantId: "token", handle: "team-helper", displayName: "x" },
    { participantId: "prefix", handle: "helper-team", displayName: "x" },
    {
      participantId: "source",
      handle: "other",
      displayName: "x",
      sourceServerLabel: "helper",
    },
    {
      participantId: "description",
      handle: "unrelated",
      displayName: "x",
      description: "a-b-c",
    },
  ];
  const query = (query: string) =>
    filterComposerMentionAgents(rows, {
      start: 0,
      end: query.length + 1,
      query,
    }).map((x) => x.participantId);
  assert.deepEqual(query("helper"), ["source", "prefix", "token", "substring"]);
  assert.ok(!query("ac").includes("description"));
});
