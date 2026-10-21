import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { adaptMessageProfileNavigation } from "../../frontends/raft/loom/message-profile-navigation.ts";
test("member navigation gains controlled callbacks; unrelated readonly guards stay unchanged", () => {
  const source = readFileSync(
    "frontends/raft/upstream/raft-web-source/packages/web/src/components/message/MessageItem.tsx",
    "utf8",
  );
  const result = adaptMessageProfileNavigation(source);
  const original =
    "onNavigateAgent={readOnlyProjection ? ignoreReadOnlyProjectionNavigation : handleNavigateAgent}";
  const adapted =
    'onNavigateAgent={onOpenProfile ? (id) => onOpenProfile("agent", id) : readOnlyProjection ? ignoreReadOnlyProjectionNavigation : handleNavigateAgent}';
  assert.equal(result.split(original).length, 1);
  assert.equal(result.split(adapted).length, 4);
  const human =
    "onNavigateHuman={readOnlyProjection ? ignoreReadOnlyProjectionNavigation : handleNavigateHuman}";
  const adaptedHuman =
    'onNavigateHuman={onOpenProfile ? (id) => onOpenProfile("human", id) : readOnlyProjection ? ignoreReadOnlyProjectionNavigation : handleNavigateHuman}';
  const focused =
    "onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); onClickAgent(); }}";
  assert.ok(result.includes(focused));
  assert.equal(
    result
      .replaceAll(adapted, original)
      .replaceAll(adaptedHuman, human)
      .replace(focused, "onClick={onClickAgent}"),
    source,
  );
  assert.throws(() => adaptMessageProfileNavigation("unknown upstream"));
});
