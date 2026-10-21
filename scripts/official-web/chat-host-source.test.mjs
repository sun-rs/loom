import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateChatHosts } from "./generate-chat-hosts.mjs";
const read = (p) => readFileSync(p, "utf8");
test("message/input hosts are reproducible bindings over pinned originals, not Vite mutations", () => {
  for (const [name, source] of Object.entries(generateChatHosts()))
    assert.equal(read("frontends/raft/loom/" + name), source);
  const vite = read("frontends/raft/loom/vite.config.ts");
  assert.doesNotMatch(
    vite,
    /adaptMessageStatus|adaptComposerDirectory|adaptReactions|adaptTaskComposer/,
  );
  const item = read("frontends/raft/loom/OfficialMessageItem.generated.tsx");
  assert.match(item, /boundMessageMentions\(mentionMap, message.mentions\)/);
  assert.match(item, /LoomAttachments/);
  assert.match(item, /readOnlyProjection/);
  const input = read("frontends/raft/loom/OfficialMessageInput.generated.tsx");
  assert.match(input, /useComposerChannels/);
  assert.match(input, /onSendOverride\(msg, mentionsToSend, submitAsTask\)/);
  assert.match(input, /e.nativeEvent.isComposing/);
});
