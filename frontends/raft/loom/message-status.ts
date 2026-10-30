import type {
  RoomAgentActivity,
  AgentCatalogEntry,
  AgentPresence,
} from "@rah-os/protocol";
import { instanceActivity } from "./working-state.ts";
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
/** Membership/lifecycle gates the badge; its colour is the same Host observation
 * used by member settings. Room idle/waking is work state, never connectivity. */
export function messageInstancePresence(
  facts: MessageStatusFacts | undefined,
  roomId: string,
  id: string,
  catalog: readonly AgentCatalogEntry[],
  presence: readonly AgentPresence[],
) {
  if (!facts || facts.roomId !== roomId) return "unknown";
  if (!facts.members.includes(id)) return "left";
  return instanceActivity(id, catalog, presence) ?? "unknown";
}
