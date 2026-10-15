import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { adaptMessageProfileNavigation } from "../../frontends/raft/loom/message-profile-navigation.ts";
test("only the sender avatar gains a controlled callback; all other readonly guards stay unchanged", () => {
  const source = readFileSync(
    "frontends/raft/packages/web/src/components/message/MessageItem.tsx",
    "utf8",
  );
  const result = adaptMessageProfileNavigation(source);
  const original =
    "onNavigateAgent={readOnlyProjection ? ignoreReadOnlyProjectionNavigation : handleNavigateAgent}";
  const adapted =
    'onNavigateAgent={onOpenProfile ? (id) => onOpenProfile("agent", id) : readOnlyProjection ? ignoreReadOnlyProjectionNavigation : handleNavigateAgent}';
  assert.equal(result.split(original).length, 3);
  assert.equal(result.replace(adapted, original), source);
  assert.throws(() => adaptMessageProfileNavigation("unknown upstream"));
});
