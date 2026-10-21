import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateMessageMarkdown } from "./generate-message-markdown.mjs";
const read = (p) => readFileSync(p, "utf8");
test("message rendering is generated from immutable source with explicit parser dependencies", () => {
  for (const [name, source] of Object.entries(generateMessageMarkdown()))
    assert.equal(read("frontends/raft/loom/" + name), source);
  const local = read("frontends/raft/loom/OfficialMessageItem.generated.tsx");
  assert.match(local, /import useRenderMessageMarkdown from/);
  assert.doesNotMatch(
    local,
    /function useRenderMessageMarkdown|codePlaceholders|protectMarkdownInlineLinks|rehypeRaw/,
  );
  const generated = read(
    "frontends/raft/loom/OfficialMessageMarkdown.generated.tsx",
  );
  assert.match(generated, /source=\{content\}/);
  assert.match(generated, /messageMarkdownRemarkPlugins/);
  assert.doesNotMatch(generated, /useMessageStore|useThreadStore|getSocket/);
  assert.match(
    read("frontends/raft/loom/OfficialMessageItem.generated.tsx"),
    /boundMessageMentions\(mentionMap, message.mentions\)/,
  );
});
