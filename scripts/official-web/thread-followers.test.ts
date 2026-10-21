import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ThreadFollowersClient } from "../../frontends/raft/loom/thread-followers-client.ts";
import {
  adaptThreadFollowers,
  adaptThreadFollowerRow,
} from "./chat-affordance-bindings.ts";

test("native follower presentation retained while stores and fabricated presence are removed", () => {
  const source = readFileSync(
    "frontends/raft/upstream/raft-web-source/packages/web/src/components/thread/ThreadAgentFollowers.tsx",
    "utf8",
  );
  const result = adaptThreadFollowers(source);
  assert.equal(
    result.slice(result.indexOf("  return (\n")),
    source.slice(source.indexOf("  return (\n")),
  );
  assert.ok(!result.includes("const roster = useThreadAgentFollowerStore"));
  const row = adaptThreadFollowerRow(
    readFileSync(
      "frontends/raft/upstream/raft-web-source/packages/web/src/components/thread/ThreadAgentFollowerRow.tsx",
      "utf8",
    ),
  );
  assert.ok(row.includes("onRowClick={openAgentProfile}"));
  assert.ok(!row.includes("agentFallbackActivity={"));
  assert.throws(() => adaptThreadFollowers("wrong source"));
});
test("remove returns only server undo token; restore binds exact thread and participant", async () => {
  const calls: any[] = [];
  const client: any = {
    request: async (op: string, input: any) => {
      calls.push([op, input]);
      return op === "thread.follower.remove"
        ? {
            removed: true,
            undoToken: "undo",
            undoExpiresAt: "2030-01-01T00:00:00Z",
          }
        : { restored: true };
    },
  };
  const b = new ThreadFollowersClient(client, "room", "thread");
  const removed = await b.remove("agent");
  assert.equal(removed.removed, true);
  assert.equal(await b.restore("agent", "undo"), true);
  assert.deepEqual(calls, [
    [
      "thread.follower.remove",
      { roomId: "room", threadId: "thread", participantId: "agent" },
    ],
    [
      "thread.follower.restore",
      {
        roomId: "room",
        threadId: "thread",
        participantId: "agent",
        undoToken: "undo",
      },
    ],
  ]);
});
test("lost remove is never resent and cannot invent an undo token", async () => {
  const calls: any[] = [];
  const b = new ThreadFollowersClient(
    {
      request: async (op: string) => {
        calls.push(op);
        throw Error("lost");
      },
    } as any,
    "r",
    "t",
  );
  await assert.rejects(b.remove("a"));
  assert.deepEqual(calls, ["thread.follower.remove"]);
});
