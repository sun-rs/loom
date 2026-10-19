import type { RoomAgentActivity } from "@rah-os/protocol";
export type MessageStatusFacts = {
  roomId: string;
  members: readonly string[];
  activities: readonly Pick<
    RoomAgentActivity,
    "roomId" | "participantId" | "state"
  >[];
};
/** Presentation only: missing observations are unknown, not offline/deleted. */
export function messageInstanceState(
  facts: MessageStatusFacts | undefined,
  roomId: string,
  id: string,
) {
  if (!facts || facts.roomId !== roomId) return "unknown";
  if (!facts.members.includes(id)) return "left";
  return (
    facts.activities.find((a) => a.roomId === roomId && a.participantId === id)
      ?.state ?? "unknown"
  );
}
