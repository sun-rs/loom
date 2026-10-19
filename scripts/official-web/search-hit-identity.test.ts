import assert from "node:assert/strict";
import test from "node:test";
import type { RahClient } from "@rah-os/client-sdk";
import { searchPage } from "../../frontends/raft/loom/discovery-client.ts";
test("hit metadata, not directory search matches, determines author avatar and conversation type", async () => {
  const client = {
    request: async () => ({
      total: 1,
      rooms: [],
      principals: [],
      hits: [
        {
          message: { messageId: "m", roomId: "box", actorId: "agent" },
          roomName: "Tom-1",
          senderName: "Tom-1",
          senderKind: "agent",
          roomKind: "direct",
          roomArchivedAt: "2026-10-19T00:00:00Z",
        },
      ],
    }),
  } as unknown as RahClient;
  const { rows } = await searchPage(client, {
    workspaceId: "w",
    query: "unrelated name",
  });
  assert.equal(rows[0]?.senderType, "agent");
  assert.equal(rows[0]?.channelType, "dm");
  assert.equal(rows[0]?.archivedAt, "2026-10-19T00:00:00Z");
});
