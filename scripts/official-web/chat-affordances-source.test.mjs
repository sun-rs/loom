import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/" + p, "utf8");
test("message affordances and follower views reproduce locked original source with explicit bindings", async () => {
  const { generateChatAffordances } =
    await import("./generate-chat-affordances.mjs");
  for (const [name, value] of Object.entries(generateChatAffordances()))
    assert.equal(read("loom/" + name), value, name);
  for (const [file, name] of [
    ["message/MessageHoverToolbar", "MessageHoverToolbar"],
    ["message/MentionLink", "MentionLink"],
    ["thread/ThreadAgentFollowers", "ThreadAgentFollowers"],
    ["thread/ThreadAgentFollowerRow", "ThreadAgentFollowerRow"],
  ])
    assert.match(
      read("packages/web/src/components/" + file + ".tsx"),
      new RegExp("Official" + name + ".generated"),
    );
  assert.doesNotMatch(
    read("loom/vite.config.ts"),
    /adaptReactionToolbar|adaptThreadFollowers|adaptThreadFollowerRow|Official MentionLink viewer seam/,
  );
});
test("mention native pixel and preview recipes are retained without old width override", () => {
  const s = read("loom/OfficialMentionLink.generated.tsx");
  assert.match(s, /rounded-\[2px\] border-\[1.5px\] border-sticker-ink/);
  assert.doesNotMatch(s, /w-\[280px\]|useAuthStore/);
  assert.match(s, /useMessageViewerId/);
  assert.match(s, /from "\.\/MessageProfile"/);
});
test("follower view cannot restore upstream socket, business stores or fabricate activity", () => {
  const s = read("loom/OfficialThreadAgentFollowers.generated.tsx");
  assert.doesNotMatch(
    s,
    /getSocket|useThreadAgentFollowerStore|useServerStore/,
  );
  const row = read("loom/OfficialThreadAgentFollowerRow.generated.tsx");
  assert.doesNotMatch(
    row,
    /setCachedAgentProfile|useProfileStore|AgentActivityInfo|agentFallbackActivity=/,
  );
  assert.match(s, /useLoomThreadFollowers/);
  assert.match(row, /useLoomFollowerProfile/);
});
test("composer native input and action composition are source-derived while Loom owns file and send callbacks", async () => {
  const { generateComposerView } = await import("./generate-composer-view.mjs");
  assert.equal(
    read("loom/OfficialComposerView.generated.tsx"),
    generateComposerView(),
  );
  assert.match(
    read("loom/OfficialMessageInput.generated.tsx"),
    /<OfficialComposerView/,
  );
  assert.doesNotMatch(read("loom/vite.config.ts"), /adaptAttachmentComposer/);
  assert.match(
    read("loom/OfficialComposerView.generated.tsx"),
    /<CheckboxIndicator/,
  );
});
