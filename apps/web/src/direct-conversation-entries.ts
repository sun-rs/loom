import type { Room } from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";

export type DirectConversationEntry = {
  key: string;
  label: string;
  agent?: WorkspaceAgentView;
  peerPrincipalId?: string;
  roomId?: string;
};

export function directConversationPeer(
  agents: readonly WorkspaceAgentView[],
  room: Room | undefined,
  humanId: string | undefined,
): WorkspaceAgentView | undefined {
  if (
    room?.kind !== "direct" ||
    humanId === undefined ||
    !room.directParticipantIds?.includes(humanId)
  )
    return undefined;
  const peer = room.directParticipantIds?.find((id) => id !== humanId);
  return agents.find((agent) => agent.participantId === peer);
}

/** Presentation only. room.direct.open remains the sole open-or-create owner. */
export function directConversationEntries(
  agents: readonly WorkspaceAgentView[],
  rooms: readonly Room[],
  humanId: string | undefined,
): DirectConversationEntry[] {
  const directRooms = rooms.filter(
    (room) =>
      room.kind === "direct" &&
      room.archivedAt === undefined &&
      !agents.some(
        (agent) =>
          agent.instanceChannelId !== undefined &&
          room.directParticipantIds?.includes(agent.participantId),
      ),
  );
  const matchedRooms = new Set<string>();
  const rows: DirectConversationEntry[] = agents
    .filter((agent) => agent.instanceChannelId === undefined)
    .filter(
      (agent) =>
        agent.state !== "tombstoned" ||
        directRooms.some(
          (room) =>
            directConversationPeer([agent], room, humanId) !== undefined,
        ),
    )
    .map((agent) => {
      const room = directRooms.find(
        (room) =>
          humanId !== undefined &&
          room.directParticipantIds?.includes(humanId) &&
          room.directParticipantIds.includes(agent.participantId),
      );
      if (room !== undefined) matchedRooms.add(room.roomId);
      return {
        key: agent.participantId,
        label: agent.displayName,
        agent,
        peerPrincipalId: agent.participantId,
        ...(room === undefined ? {} : { roomId: room.roomId }),
      };
    });
  for (const room of directRooms) {
    if (matchedRooms.has(room.roomId)) continue;
    const peerPrincipalId = room.directParticipantIds?.find(
      (id) => id !== humanId,
    );
    rows.push({
      key: room.roomId,
      label: room.name,
      roomId: room.roomId,
      ...(peerPrincipalId === undefined ? {} : { peerPrincipalId }),
    });
  }
  return rows;
}
