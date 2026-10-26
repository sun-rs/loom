import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { composerMemberProjection } from "../../frontends/raft/loom/composer-member-projection.ts";
test("composer projects its own room snapshot without relying on another mounted roster reader", () => {
  const scope = {
    roomId: "room",
    members: [
      {
        principalId: "i",
        kind: "agent" as const,
        handle: "tom-1",
        displayName: "Tom",
      },
    ],
  };
  assert.equal(
    composerMemberProjection(scope, "room", true).agents[0]?.id,
    "i",
  );
  assert.equal(
    composerMemberProjection(scope, "room", true).agents[0]?.displayName,
    "Tom",
  );
  assert.deepEqual(composerMemberProjection(scope, "other", true).agents, []);
  assert.deepEqual(composerMemberProjection(scope, "room", false).agents, []);
  assert.deepEqual(
    composerMemberProjection({ ...scope, members: [] }, "room", true).agents,
    [],
  );
});
test("native composer data import binds scoped projection while both hosts supply current members", () => {
  const read = (p: string) => readFileSync("frontends/raft/loom/" + p, "utf8");
  assert.match(
    read("OfficialMessageInput.generated.tsx"),
    /from "\.\/ComposerMembers"/,
  );
  assert.match(read("ChannelApp.tsx"), /mentionMembers=\{view.members\}/);
  assert.match(read("ThreadWorkspace.tsx"), /mentionMembers=\{data\?\.members/);
});
