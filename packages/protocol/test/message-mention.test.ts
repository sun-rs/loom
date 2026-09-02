import assert from "node:assert/strict";
import test from "node:test";

import {
  messageHasMention,
  messageMentionCandidates,
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
