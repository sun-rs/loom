import type { RahClient } from "@rah-os/client-sdk";
import type {
  AgentRoomEventActivityRecord,
  Principal,
  Room,
} from "@rah-os/protocol";
import { projectChannelMembers } from "./channel-members.ts";

/** Read-only presentation. Kernel owns identity, membership and run facts. */
export async function loadInstanceActivity(
  client: RahClient,
  input: {
    controlRoomId: string;
    room: Room;
    member: Principal;
    beforeActivityId?: string;
  },
  signal?: AbortSignal,
) {
  const { room, member } = input;
  if (member.kind !== "agent") throw Error("此成员不是实例");
  const catalog = await client.request(
    "role.list",
    { controlRoomId: input.controlRoomId },
    { signal },
  );
  const instance = catalog.instances.find(
    (i) => i.instanceId === member.principalId,
  );
  if (
    !instance ||
    (room.instancePrivateBox
      ? room.instancePrivateBox.instanceId !== instance.instanceId
      : instance.channelId !== room.roomId)
  )
    throw Error("此对话的实例资料不可用");
  const [state, page] = await Promise.all([
    client.request(
      "room.agent.activity.list",
      { roomId: room.roomId },
      { signal },
    ),
    client.request(
      "agent.activity.list",
      {
        agentId: instance.agentId,
        limit: 20,
        ...(input.beforeActivityId
          ? { beforeActivityId: input.beforeActivityId }
          : {}),
      },
      { signal },
    ),
  ]);
  return {
    stateLabel: projectChannelMembers(room.roomId, [member], state.agents)[0]!
      .detail,
    records: page.activities
      .filter(
        (r): r is AgentRoomEventActivityRecord =>
          r.source === "room_event" &&
          r.participantId === member.principalId &&
          r.roomId === room.roomId &&
          r.aggregateType === "run_attempt",
      )
      .sort((a, b) => a.roomSeq - b.roomSeq),
    nextCursor: page.nextCursor,
  };
}
