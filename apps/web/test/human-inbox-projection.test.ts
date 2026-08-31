import assert from "node:assert/strict";
import test from "node:test";

import type { InputRequest } from "@rah-os/protocol";

import { pendingInputRequestsForHuman } from "../src/human-inbox-projection.ts";

function request(input: {
  createdAt: string;
  id: string;
  responderId: string;
  state?: "pending" | "resolved";
}): InputRequest {
  const state = input.state ?? "pending";
  return {
    inputRequestId: input.id,
    roomId: "room-a",
    taskId: `task-${input.id}`,
    requesterId: "agent-a",
    responderId: input.responderId,
    question: `Question ${input.id}?`,
    state,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    ...(state === "resolved"
      ? {
          answer: "Done",
          resolvedAt: input.createdAt,
          resolvedBy: input.responderId,
        }
      : {}),
  };
}

test("Human Inbox contains only pending requests designated to that Human", () => {
  const newest = request({
    createdAt: "2026-08-30T10:02:00.000Z",
    id: "newest",
    responderId: "human-owner",
  });
  const oldest = request({
    createdAt: "2026-08-30T10:00:00.000Z",
    id: "oldest",
    responderId: "human-owner",
  });
  assert.deepEqual(
    pendingInputRequestsForHuman({
      inputRequests: [
        oldest,
        request({
          createdAt: "2026-08-30T10:01:00.000Z",
          id: "other-human",
          responderId: "human-other",
        }),
        request({
          createdAt: "2026-08-30T10:03:00.000Z",
          id: "resolved",
          responderId: "human-owner",
          state: "resolved",
        }),
        newest,
        newest,
      ],
      principalId: "human-owner",
    }).map(({ inputRequestId }) => inputRequestId),
    ["newest", "oldest"],
  );
  assert.deepEqual(
    pendingInputRequestsForHuman({
      inputRequests: [newest],
      principalId: undefined,
    }),
    [],
  );
});
