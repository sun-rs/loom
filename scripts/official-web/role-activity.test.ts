import test from "node:test";
import assert from "node:assert/strict";
import { loadRoleActivity } from "../../frontends/raft/loom/role-activity.ts";
import { readFileSync } from "node:fs";
test("role activity is scoped to each member, merged by time and retains partial failures", async () => {
  const sources = [
    { agentId: "a", instanceId: "pa", roomId: "ra", name: "Tom-1" },
    { agentId: "b", instanceId: "pb", roomId: "rb", name: "Tom-2" },
    { agentId: "c", instanceId: "pc", roomId: "rc", name: "Tom-3" },
  ];
  const record = (id, participantId, roomId, time) => ({
    activityId: id,
    participantId,
    roomId,
    observedAt: time,
    serverSequence: 1,
    entry: { kind: "text", text: id },
  });
  const client = {
    request: async (_command, input) => {
      assert.equal(input.limit, 50);
      if (input.agentId === "c") throw Error("offline");
      return {
        activities:
          input.agentId === "a"
            ? [
                record("a", "pa", "ra", "2026-01-01"),
                record("secret", "pa", "wrong", "2026-02-01"),
              ]
            : [record("b", "pb", "rb", "2026-01-02")],
        nextCursor: "older",
      };
    },
  };
  const result = await loadRoleActivity(client as never, sources);
  assert.deepEqual(
    result.rows.map((x) => x.record.activityId),
    ["b", "a"],
  );
  assert.deepEqual(result.failed, ["Tom-3"]);
  assert.equal(result.nextCursor, undefined);
  const single = await loadRoleActivity(
    client as never,
    [sources[0]],
    undefined,
    "cursor",
  );
  assert.equal(single.nextCursor, "older");
});
test("model/effort have one editor and Role tabs default to profile with instances inside profile", () => {
  const profile = readFileSync("frontends/raft/loom/RoleProfile.tsx", "utf8");
  assert.doesNotMatch(profile, /field: "reasoning"/);
  const editor = readFileSync("frontends/raft/loom/RoleEditor.tsx", "utf8");
  assert.doesNotMatch(editor, /field === "reasoning"/);
  const page = readFileSync("frontends/raft/loom/AgentPage.tsx", "utf8");
  assert.match(page, /useState\("roles"\)/);
  assert.match(page, /setTab\("roles"\)/);
  assert.doesNotMatch(page, /tab !== "instances"/);
});

import { generateActivity } from "./generate-activity.mjs";
test("timeline rows use exact official source extraction, without upstream stores", () => {
  const generated = readFileSync(
    "frontends/raft/loom/OfficialActivity.generated.tsx",
    "utf8",
  );
  assert.equal(generated, generateActivity());
  assert.doesNotMatch(generated, /useAgentStore|getSocket/);
});
test("aggregate read concurrency and rendered history remain bounded", async () => {
  let active = 0,
    max = 0;
  const sources = Array.from({ length: 9 }, (_, i) => ({
    agentId: `a${i}`,
    instanceId: `p${i}`,
    roomId: `r${i}`,
    name: `N${i}`,
  }));
  const client = {
    request: async (_cmd, input) => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      const source = sources.find((s) => s.agentId === input.agentId)!;
      return {
        activities: Array.from({ length: 50 }, (_, i) => ({
          activityId: source.agentId + i,
          roomId: source.roomId,
          participantId: source.instanceId,
          serverSequence: i,
          observedAt: "2026-01-01",
          entry: { kind: "text", text: "fixture" },
        })),
      };
    },
  };
  const result = await loadRoleActivity(client as never, sources);
  assert.ok(max <= 4);
  assert.equal(result.rows.length, 100);
});

// Differential contract: evaluate the pinned upstream default expression,
// rather than asserting whichever default Loom currently implements.
test("Role entry default matches official AgentDetailPanel regardless of tab order", () => {
  const upstream = readFileSync(
    "frontends/raft/upstream/raft-web-source/packages/web/src/components/agent/AgentDetailPanel.tsx",
    "utf8",
  );
  const expression = upstream.match(
    /const defaultAgentTab: AgentTab = ([\s\S]*?);/,
  );
  assert.ok(
    expression,
    "Upstream default rule changed: review the composition before updating this test",
  );
  const officialDefault = new Function(
    "visibleAgentTabs",
    `return (${expression[1]});`,
  );
  const local = readFileSync("frontends/raft/loom/AgentPage.tsx", "utf8");
  const initial = local.match(
    /const \[tab, setTab\] = useState\("([^" ]+)"\)/,
  )?.[1];
  const selection = local.match(
    /const selectRole = [\s\S]*?setTab\("([^" ]+)"\)/,
  )?.[1];
  const semanticName = (tab: string | undefined) =>
    tab === "roles" ? "profile" : tab;
  for (const tabs of [
    ["activity", "profile"],
    ["profile", "activity"],
  ]) {
    assert.equal(semanticName(initial), officialDefault(tabs));
    assert.equal(semanticName(selection), officialDefault(tabs));
  }
});
