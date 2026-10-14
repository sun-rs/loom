import assert from "node:assert/strict";
import test from "node:test";
import { projectChannelMembers } from "../../frontends/raft/loom/channel-members.ts";

test("members show instance names and only this channel's authoritative execution state", () => {
  const members = [
    { principalId: "a", kind: "agent" as const, handle: "Tom-1" },
    { principalId: "b", kind: "agent" as const, handle: "Tom-2" },
    { principalId: "h", kind: "human" as const, handle: "owner" },
  ];
  const view = projectChannelMembers("room-a", members, [
    {
      participantId: "a",
      roomId: "room-a",
      state: "working",
      queued: true,
      updatedAt: "2026-10-14T00:00:00Z",
    },
    {
      participantId: "b",
      roomId: "private-box",
      state: "idle",
      queued: false,
      updatedAt: "2026-10-14T00:00:00Z",
    },
    {
      participantId: "removed",
      roomId: "room-a",
      state: "working",
      updatedAt: "2026-10-14T00:00:00Z",
    },
  ]);
  assert.equal(view.length, 3);
  assert.deepEqual(
    view.map((m) => m.name),
    ["Tom-1", "Tom-2", "owner"],
  );
  assert.match(view[0].detail, /运行中.*本频道有排队工作/);
  assert.match(view[1].detail, /状态未知.*排队未知/);
  assert.equal(view[2].detail, "Human");
});

test("queued is a flag, missing state is unknown, and blocked work stays explicit", () => {
  const member = { principalId: "a", kind: "agent" as const, handle: "Tom-1" };
  for (const [state, label] of [
    ["idle", "空闲"],
    ["waking", "排队或启动中"],
    ["error", "错误"],
  ] as const) {
    const [view] = projectChannelMembers(
      "r",
      [member],
      [
        {
          participantId: "a",
          roomId: "r",
          state,
          updatedAt: "2026-10-14T00:00:00Z",
          blocked: {
            activationId: "hold",
            roomId: "r",
            reason: "failure",
            holdsLane: true,
          },
        },
      ],
    );
    assert.match(view.detail, new RegExp(label));
    assert.match(view.detail, /排队未知/);
    assert.match(view.detail, /需要处理/);
    assert.doesNotMatch(view.detail, /在线|排队 0/);
  }
});
