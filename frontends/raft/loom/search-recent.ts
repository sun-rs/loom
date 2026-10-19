import { selectRecentConversationEntities } from "../packages/web/src/components/search/recentConversations.ts";
import type { SearchEntity } from "./search-entities.ts";
/** Native selector; Loom supplies sidebar peer keys and authorized activity timestamps; never invented visits. */
export function recentSearchEntities(
  visits: readonly string[],
  entities: SearchEntity[],
  hiddenDms: readonly string[],
  excludeRoomId: string | undefined,
  activity: Readonly<Record<string, string | null>> = {},
) {
  return selectRecentConversationEntities({
    recentChannelIds: visits,
    entities,
    activity,
    eligibleEntityKeys: new Set(
      entities
        .filter(
          (e) =>
            e.type === "channel" || !hiddenDms.includes("peer:" + e.agentId),
        )
        .map((e) => e.key),
    ),
    excludeChannelId: excludeRoomId,
    fillFromActivity: true,
  });
}
