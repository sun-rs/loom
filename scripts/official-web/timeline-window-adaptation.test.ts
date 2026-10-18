import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adaptTimelineWindow } from "../../frontends/raft/loom/timeline-window-adaptation.ts";
test("bounded window shifts reuse the native anchor owner and fail closed on upstream drift", () => {
  const source = readFileSync(
    new URL(
      "../../frontends/raft/packages/web/src/components/message/MessageTimeline.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const adapted = adaptTimelineWindow(source);
  assert.match(adapted, /restoreAnchor\(scroller, survivingAnchor, true\)/);
  assert.match(
    adapted,
    /isFollowingBottomRef.current \|\| armedFollowRef.current/,
  );
  assert.throws(
    () =>
      adaptTimelineWindow(
        source.replace("} else if (firstChanged && lastChanged) {", "else {"),
      ),
    /boundary/,
  );
});
