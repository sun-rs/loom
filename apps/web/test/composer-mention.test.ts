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
      "../../../packages/ui-tokens/src/neo-brutalist/styles.css",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal(panes.match(/<ComposerMentionMenu/g)?.length, 2);
  assert.match(component, /mention-row.*is-active/su);
  assert.match(component, /role="listbox"/u);
  assert.match(component, /<AgentAvatar/u);
  assert.match(panes, /mentionAgentIds/u);
  assert.match(
    css,
    /\.mention-row\.is-active\s*\{\s*background:\s*var\(--yellow\)/u,
  );
});
