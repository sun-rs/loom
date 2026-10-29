import test from "node:test";
import assert from "node:assert/strict";
import { localMessagePermalink } from "../../frontends/raft/loom/message-links.ts";
test("local message links contain only their canonical room/message/thread target", () => {
  const url = new URL(
    localMessagePermalink("https://loom.local:4178", "r +", "m/1", "root?"),
  );
  assert.equal(url.origin, "https://loom.local:4178");
  assert.equal(url.searchParams.get("room"), "r +");
  assert.equal(url.searchParams.get("message"), "m/1");
  assert.equal(url.searchParams.get("thread"), "root?");
  assert.equal([...url.searchParams].length, 3);
  assert.equal(
    new URL(
      localMessagePermalink("http://localhost:4176", "r", "m"),
    ).searchParams.has("thread"),
    false,
  );
});
