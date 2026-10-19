import type {
  Room,
  RoleListResponse,
  AgentCatalogEntry,
} from "@rah-os/protocol";
import type { SearchEntitySourceParams } from "../packages/web/src/components/search/searchEntities.ts";
export type SearchEntity =
  import("../packages/web/src/components/search/searchEntities.ts").SearchEntityResult;
/** Read-only native search projection. Names come from frozen instance configurations, never current Roles. */
export function entitySources({
  rooms,
  instances,
  agents,
}: {
  rooms: Room[];
  instances: RoleListResponse["instances"];
  agents: AgentCatalogEntry[];
}): SearchEntitySourceParams {
  const channels = rooms.filter((r) => r.kind === "channel");
  const visible = new Set(channels.map((r) => r.roomId));
  const members = instances.flatMap((i) => {
    const a = agents.find((a) => a.definition.agentId === i.agentId);
    return a && a.definition.state !== "tombstoned" && visible.has(i.channelId)
      ? [
          {
            id: i.instanceId,
            name: a.handle,
            // Role revision displayName describes configuration; the member identity is its instance handle.
            displayName: a.handle,
            description: a.currentRevision.description,
            deletedAt: null,
          },
        ]
      : [];
  });
  // Native builder reads only these fields; upstream store objects are not business state.
  return {
    channels: channels.map((r) => ({
      id: r.roomId,
      name: r.name,
      type: "channel",
      archivedAt: r.archivedAt ?? null,
    })) as SearchEntitySourceParams["channels"],
    agents: members as SearchEntitySourceParams["agents"],
    dmChannels: rooms
      .filter((r) => r.kind === "direct" && r.instancePrivateBox && !r.side)
      .map((r) => ({
        id: r.roomId,
        type: "dm",
        peerType: "agent",
        peerId: r.instancePrivateBox!.instanceId,
      })) as SearchEntitySourceParams["dmChannels"],
    machines: [],
    members: [],
    currentUser: null,
  };
}
