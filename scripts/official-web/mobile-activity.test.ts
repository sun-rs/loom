import test from "node:test";
import assert from "node:assert/strict";
import {
  nativePullOffset,
  activityReadToggle,
} from "../../frontends/raft/loom/mobile-activity.ts";
test("native rubber band and start-action authority", () => {
  assert.equal(nativePullOffset(-1, 844), 0);
  assert.equal(nativePullOffset(300, 0), 0);
  assert.ok(nativePullOffset(230, 844) > 100);
  assert.ok(nativePullOffset(100, 844) < 100);
  assert.equal(
    activityReadToggle({
      activityFrontier: { throughSeq: 3 },
      unread: 1,
      activityKind: "channel",
    }),
    "read",
  );
  assert.equal(
    activityReadToggle({
      activityFrontier: { throughSeq: 3 },
      unread: 0,
      activityKind: "thread",
      isFollowing: true,
    }),
    "unread",
  );
  assert.equal(
    activityReadToggle({
      activityFrontier: { throughSeq: 3 },
      activityKind: "thread",
      isFollowing: false,
    }),
    undefined,
  );
  assert.equal(activityReadToggle({ unread: 1 }), undefined);
});

test("selected native source remains byte exact to its recorded revision", async () => {
  const { readFileSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const root = "frontends/raft/upstream/raft-mobile-source/";
  const lock = JSON.parse(readFileSync(root + "source-lock.json", "utf8"));
  for (const file of lock.files)
    assert.equal(
      createHash("sha256")
        .update(readFileSync(root + file.path))
        .digest("hex"),
      file.sha256,
      file.path,
    );
});
