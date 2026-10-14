import assert from "node:assert/strict";
import test from "node:test";
import api from "../../frontends/raft/loom/upstream-api.ts";
import {
  bindMemberRoster,
  projectMentionMembers,
} from "../../frontends/raft/loom/member-roster.ts";
test("native roster reads only the mounted Room owner and rejects other endpoints or writes", async () => {
  let members = [
    {
      principalId: "tom-1",
      kind: "agent" as const,
      handle: "Tom-1",
      displayName: "Tom 一号",
    },
  ];
  const release = bindMemberRoster("a", () => members);
  try {
    assert.equal(
      (await api.get("/channels/a/members")).data.agents[0].name,
      "Tom-1",
    );
    await assert.rejects(api.get("/channels/b/members"));
    await assert.rejects(
      api.post("/channels/a/members", { agentId: "intruder" }),
    );
    await assert.rejects(api.get("/servers/a/agents"));
    members = [];
    assert.deepEqual((await api.get("/channels/a/members")).data.agents, []);
  } finally {
    release();
  }
  await assert.rejects(api.get("/channels/a/members"));
});
test("mention projection retains canonical handles and instance IDs without inventing execution state", () => {
  const result = projectMentionMembers([
    {
      principalId: "one",
      kind: "agent",
      handle: "Tom-1",
      displayName: "Tom 一号",
    },
    { principalId: "two", kind: "agent", handle: "Tom-2" },
    { principalId: "svc", kind: "service", handle: "internal" },
  ]);
  assert.deepEqual(
    result.agents.map((a) => [a.id, a.name]),
    [
      ["one", "Tom-1"],
      ["two", "Tom-2"],
    ],
  );
  assert.equal(result.agents[0].displayName, "Tom 一号");
  assert.equal("activity" in result.agents[0], false);
  assert.equal("status" in result.agents[0], false);
  assert.deepEqual(result.humans, []);
});

test("disposing an older mounted reader cannot remove its replacement", async () => {
  const old = bindMemberRoster("same", () => [
    { principalId: "old", kind: "agent", handle: "Old" },
  ]);
  const current = bindMemberRoster("same", () => [
    { principalId: "new", kind: "agent", handle: "New" },
  ]);
  old();
  try {
    assert.equal(
      (await api.get("/channels/same/members")).data.agents[0].id,
      "new",
    );
  } finally {
    current();
  }
  await assert.rejects(api.get("/channels/same/members"));
});
