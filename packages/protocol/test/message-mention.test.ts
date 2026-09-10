import assert from "node:assert/strict";
import test from "node:test";

import {
  messageHasMention,
  messageMentionCandidates,
  messageMentionQueryAt,
  unresolvedMentionHandles,
} from "../src/message-mention.ts";

test("message mention grammar supports CJK prose and dotted handles with stable boundaries", () => {
  const source = "请@Alice和 @team.bot 看；x@Alice 与 @Alice-extra 不算 Alice";
  assert.deepEqual(messageMentionCandidates(source, ["Alice", "team.bot"]), [
    {
      end: source.indexOf("@Alice") + "@Alice".length,
      handle: "Alice",
      start: source.indexOf("@Alice"),
      value: "@Alice",
    },
    {
      end: source.indexOf("@team.bot") + "@team.bot".length,
      handle: "team.bot",
      start: source.indexOf("@team.bot"),
      value: "@team.bot",
    },
  ]);
  assert.equal(messageHasMention("请@Alice", "alice"), true);
  assert.equal(messageHasMention("x.@Alice", "Alice"), false);
  assert.equal(messageHasMention("@Alice-extra", "Alice"), false);
});

test("message mention grammar never turns protected Markdown into delivery", () => {
  const source = [
    "正文 @Alice",
    "`@Code` [@Link](https://example.com/@url)",
    "[@Reference][who] [@Shortcut]",
    "[who]: https://example.com/profile",
    "[@Shortcut]: https://example.com/shortcut",
    "    @Indented",
    "```txt",
    "@Fence",
    "```",
    "$@Math$ <https://example.com/@auto> <span>@Html</span>",
  ].join("\n");
  assert.deepEqual(
    messageMentionCandidates(source, [
      "Alice",
      "Code",
      "Link",
      "Reference",
      "Shortcut",
      "url",
      "Indented",
      "Fence",
      "Math",
      "auto",
      "Html",
    ]).map(({ handle }) => handle),
    ["Alice"],
  );
});

test("message mention masking keeps UTF-16 indexes aligned after emoji", () => {
  assert.deepEqual(
    messageMentionCandidates("😀😀😀😀😀😀😀 `@Alice`", ["Alice"]),
    [],
  );
});

test("composer mention queries share the canonical visible-prose mask", () => {
  assert.deepEqual(messageMentionQueryAt("请@Ali", 5), {
    end: 5,
    query: "Ali",
    start: 1,
  });
  assert.equal(messageMentionQueryAt("mail@example.com", 8), undefined);
  assert.equal(messageMentionQueryAt("`@Ali`", 5), undefined);
  assert.equal(messageMentionQueryAt("```\n@Ali\n```", 8), undefined);
  assert.equal(messageMentionQueryAt("https://x.test/@Ali", 19), undefined);
  assert.equal(messageMentionQueryAt("[@Ali](https://x.test)", 5), undefined);
});

test("case or NFKC ambiguous handles fail closed", () => {
  assert.deepEqual(messageMentionCandidates("@Alice", ["Alice", "alice"]), []);
  assert.deepEqual(
    messageMentionCandidates("@Ａlice", ["Alice", "Ａlice"]),
    [],
  );
  assert.equal(
    messageMentionCandidates("@Alice", ["Alice", "Alice"]).length,
    1,
  );
});

test("unresolved mention tokens are the ones that woke nobody", () => {
  // Resolved tokens are not reported.
  assert.deepEqual(unresolvedMentionHandles("@alice ping", ["alice"]), []);
  // A handle the directory does not carry is reported.
  assert.deepEqual(unresolvedMentionHandles("@carol ping", ["alice"]), [
    "carol",
  ]);
  // The ambiguity that fails closed is the sharpest missed wake, so it must be
  // reported even though the directory does carry a matching handle.
  assert.deepEqual(
    unresolvedMentionHandles("@Alice ping", ["Alice", "alice"]),
    ["Alice"],
  );
  // Code is masked, which is why Raft tells an author to wrap a literal name.
  assert.deepEqual(
    unresolvedMentionHandles("`@carol` is prose", ["alice"]),
    [],
  );
  // An address-like token mid-word has no leading boundary and is not a token.
  assert.deepEqual(unresolvedMentionHandles("mail me@example.com", []), []);
  // Unicode handles are never split at a guessed boundary.
  assert.deepEqual(unresolvedMentionHandles("请@小明处理", ["alice"]), []);
  // Repeats collapse on the shared comparison key.
  assert.deepEqual(unresolvedMentionHandles("@carol and @Carol", []), [
    "carol",
  ]);
});
