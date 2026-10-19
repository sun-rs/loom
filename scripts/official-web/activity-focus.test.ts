import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("first unread gesture uses presentation focus only and preserves official scroll/highlight rules", () => {
  const hook = readFileSync(
    "frontends/raft/loom/useFirstUnreadFocus.ts",
    "utf8",
  );
  assert.match(hook, /rows.find\(\(row\) => \(row.unread \?\? 0\) > 0\)/);
  assert.match(hook, /3000/);
  assert.match(hook, /behavior: "smooth"/);
  assert.doesNotMatch(hook, /client.request|activity.mark|onOpenResult/);
  const nav = readFileSync("frontends/raft/loom/Navigation.tsx", "utf8");
  assert.match(nav, /onDoubleClick=/);
  assert.match(nav, /onSelect\(entry.id, true\)/);
});
