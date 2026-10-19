import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = () =>
  readFileSync(
    "frontends/raft/packages/web/src/components/message/MessageInput.tsx",
    "utf8",
  );
test("mention badges and icons keep locked official native dimensions", () => {
  const s = source();
  const body = s.slice(
    s.indexOf("function MentionCandidateBody"),
    s.indexOf("function MentionCandidateActivityBadge"),
  );
  assert.ok(!body.includes("text-[10px]"));
  assert.ok(body.includes("size-[19px]"));
  assert.ok(!body.includes("!border-black/40"));
});
test("autocomplete groups use explicit native separators and native accessory spacing", () => {
  const s = source();
  assert.ok(!s.includes("<ComposerSuggestionGroup separated"));
  assert.equal((s.match(/<Separator className="mt-1"/g) || []).length, 3);
  assert.ok(
    s.includes(
      'className="flex flex-wrap items-center gap-1.5">{accessoryRow}',
    ),
  );
});
