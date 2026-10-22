import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("instance profile orders activity first and binds private messaging to the channel owner", () => {
  const source = readFileSync(
    "frontends/raft/loom/InstanceInspector.tsx",
    "utf8",
  );
  assert.ok(
    source.indexOf('<TabsTab value="activity">') <
      source.indexOf('<TabsTab value="profile">'),
  );
  assert.match(source, /onOpenPrivate\(member.principalId\)/);
  const channel = readFileSync("frontends/raft/loom/ChannelApp.tsx", "utf8");
  assert.match(channel, /onOpenPrivate=\{onOpenPrivate\}/);
});
