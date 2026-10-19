import type { RahClient } from "@rah-os/client-sdk";
// Native recent-conversation store contains bounded visit IDs only, not messages or business state.
import { useEffect, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { Clock3 } from "lucide-react";
import { SearchResultsList } from "raft-ui";
import SectionEyebrow from "../packages/web/src/components/ui/SectionEyebrow.tsx";
import {
  useRecentConversationStore,
  getRecentConversationScopeKey,
  EMPTY_RECENT_CONVERSATION_IDS,
} from "../packages/web/src/store/recentConversationStore.ts";
import { recentSearchEntities } from "./search-recent.ts";
import { SearchEntityRow } from "./SearchEntityRows.tsx";
import type { SearchEntity } from "./search-entities.ts";
import type { useSearchEntities } from "./useSearchEntities.ts";
export function useRecordSearchVisit(
  workspaceId: string | undefined,
  principalId: string | undefined,
  roomId: string | undefined,
) {
  const record = useRecentConversationStore((s) => s.recordVisit);
  useEffect(() => {
    const key = getRecentConversationScopeKey(workspaceId, principalId);
    if (key && roomId) record(key, roomId);
  }, [workspaceId, principalId, roomId, record]);
}
export function useSearchRecent(
  entities: ReturnType<typeof useSearchEntities>,
  workspaceId: string,
  principalId: string | undefined,
  excludeRoomId: string | undefined,
  client: RahClient,
  enabled: boolean,
) {
  const [activity, setActivity] = useState<Record<string, string>>({});
  useEffect(() => {
    setActivity({});
    if (!enabled) return;
    const abort = new AbortController();
    void client
      .request(
        "activity.list",
        { workspaceId, filter: "all", limit: 50 },
        { signal: abort.signal },
      )
      .then((result) => {
        if (abort.signal.aborted) return;
        const dates: Record<string, string> = {};
        for (const item of result.items) {
          // A thread is not a visit to its parent conversation.
          if (item.kind === "thread") continue;
          const date = item.latestMessage.createdAt;
          if (
            !dates[item.roomId] ||
            Date.parse(date) > Date.parse(dates[item.roomId]!)
          )
            dates[item.roomId] = date;
        }
        setActivity(dates);
      })
      .catch(() => {
        /* A failed fallback never hides recorded visits. */
      });
    return () => abort.abort();
  }, [client, workspaceId, principalId, enabled]);
  const scope = getRecentConversationScopeKey(workspaceId, principalId);
  const visits = useRecentConversationStore((s) =>
    scope
      ? (s.scopes[scope]?.channelIds ?? EMPTY_RECENT_CONVERSATION_IDS)
      : EMPTY_RECENT_CONVERSATION_IDS,
  );
  return useMemo(
    () =>
      recentSearchEntities(
        visits,
        entities.catalog.map((e) => e.suggestion),
        entities.hiddenDms,
        excludeRoomId,
        activity,
      ),
    [visits, entities.catalog, entities.hiddenDms, excludeRoomId, activity],
  );
}
export default function SearchRecent({
  entities,
  selectedId,
  onOpen,
}: {
  entities: SearchEntity[];
  selectedId: string | null;
  onOpen: (entity: SearchEntity, full: boolean) => void;
}) {
  const { formatMessage } = useIntl();
  return (
    <div className="p-3" data-testid="search-overlay-recent">
      <SectionEyebrow as="div" className="mb-2 flex items-center gap-1.5 px-1">
        <Clock3 size={12} aria-hidden="true" />
        <span>
          {formatMessage({ id: "search.overlay.recentConversations" })}
        </span>
      </SectionEyebrow>
      <SearchResultsList>
        {entities.map((entity) => (
          <SearchEntityRow
            key={entity.key}
            entity={entity}
            selected={selectedId === entity.key}
            onOpen={onOpen}
            returnHint
          />
        ))}
      </SearchResultsList>
    </div>
  );
}
