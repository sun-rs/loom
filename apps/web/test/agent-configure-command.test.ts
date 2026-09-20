import assert from "node:assert/strict";
import test from "node:test";
import type { RahClient } from "@rah-os/client-sdk";
import type { ClientAgentGetResponse } from "@rah-os/protocol";
import {
  createAgentConfigureCommand,
  type AgentConfigurationInput,
} from "../src/agent-configure-command.ts";

const detail = {
  agent: {
    definition: { agentId: "agent" },
    currentRevision: { revision: 1 },
  },
} as ClientAgentGetResponse;
const input = {
  handle: "agent",
  displayName: "Agent",
  role: "reviewer",
  instructions: "Audit",
  runtimeOfferId: "offer",
  toolAccessMode: "full_access",
  modelIntent: { reasoning: "high", fallback: "disabled" },
} as AgentConfigurationInput;
function fixture() {
  let revision = 1,
    head = 10,
    keys = 0,
    lost = true;
  const writes: unknown[] = [];
  const response = {
    agent: { ...detail.agent, currentRevision: { revision: 2 } },
    deduplicated: false,
  };
  const client = {
    request: async (operation: string, body: unknown) => {
      if (operation === "agent.get")
        return {
          ...detail,
          agent: { ...detail.agent, currentRevision: { revision } },
        };
      writes.push(structuredClone(body));
      if (writes.length > 1) {
        assert.deepEqual(body, writes[0]);
        return { ...response, deduplicated: true };
      }
      revision = 2;
      head = 11;
      if (lost) throw new TypeError("response lost after commit");
      return response;
    },
  } as unknown as RahClient;
  const save = createAgentConfigureCommand({
    client,
    detail,
    createKey: () => `key-${++keys}`,
    session: {
      syncUntilCurrent: async () => ({
        caughtUp: true,
        state: { latestRoomSeq: head },
      }),
    },
  });
  return {
    save,
    writes,
    change: () => {
      revision = 3;
    },
    normal: () => {
      lost = false;
    },
  };
}
test("configuration response loss retries the exact committed request despite its own newer revision", async () => {
  const f = fixture();
  await assert.rejects(f.save(input), /response lost/);
  const result = await f.save({ ...input });
  assert.equal(result.deduplicated, true);
  assert.equal(f.writes.length, 2);
});
test("another edit before first dispatch is rejected without writes", async () => {
  const f = fixture();
  f.change();
  await assert.rejects(f.save(input), /其他页面/);
  assert.equal(f.writes.length, 0);
});
test("an uncertain save cannot silently become a different configuration", async () => {
  const f = fixture();
  await assert.rejects(f.save(input), /response lost/);
  await assert.rejects(f.save({ ...input, role: "changed" }), /上次配置/);
  assert.equal(f.writes.length, 1);
});
test("a proven stale rejection refreshes the causal barrier but preserves the opened Agent revision check", async () => {
  let seq = 10,
    calls = 0;
  const bodies: Array<{ basedOnRoomSeq: number }> = [];
  const client = {
    request: async (op: string, body: { basedOnRoomSeq: number }) => {
      if (op === "agent.get") return detail;
      bodies.push(body);
      if (++calls === 1) {
        seq = 11;
        throw { status: 409, code: "stale_context" };
      }
      return { deduplicated: false };
    },
  } as unknown as RahClient;
  const save = createAgentConfigureCommand({
    client,
    detail,
    createKey: () => `key-${calls}`,
    session: {
      syncUntilCurrent: async () => ({
        caughtUp: true,
        state: { latestRoomSeq: seq },
      }),
    },
  });
  await save(input);
  assert.deepEqual(
    bodies.map((b) => b.basedOnRoomSeq),
    [10, 11],
  );
});
