// Structural port of MessageSearchPage groupedMessageResults JSX; native primitives and grouping.
import { useIntl } from "react-intl";
import {
  Badge,
  ThreadIcon,
  SearchThreadResult,
  SearchThreadResultHeader,
  SearchThreadResultMeta,
  SearchThreadResultTimestamp,
  SearchThreadResultTitle,
  SearchThreadResultMessages,
} from "raft-ui";
import { getSearchRelativeTimeParts } from "../packages/web/src/components/search/searchGrouping.ts";
import { formatRelativeTimeParts } from "../packages/web/src/utils/relativeTime.ts";
import { groupSearchRows } from "./native-search.ts";
import SearchMessageRow from "./SearchMessageRow.tsx";
import type { DiscoveryRow } from "./discovery-client.ts";
export default function SearchMessageGroups({
  rows,
  query,
  selectedId,
  onOpen,
}: {
  rows: DiscoveryRow[];
  query: string;
  selectedId: string | null;
  onOpen: (row: DiscoveryRow, full: boolean) => void;
}) {
  const intl = useIntl(),
    { formatMessage } = intl;
  const renderMessageHit = (result: { row: DiscoveryRow }, nested = false) => (
    <SearchMessageRow
      key={result.row.id}
      row={result.row}
      query={query}
      selected={selectedId === result.row.message.messageId}
      nested={nested}
      onOpen={(full) => onOpen(result.row, full)}
    />
  );
  return (
    <>
      {groupSearchRows(rows).map((group) => {
        if (group.kind === "message") return renderMessageHit(group.result);
        const firstResult = group.results[0];
        const sourceLabel =
          firstResult?.row.roomName ??
          formatMessage({ id: "search.unknownSource" });
        const groupHasSelected = group.results.some(
          (r) => selectedId === r.row.message.messageId,
        );
        return (
          <SearchThreadResult
            key={group.key}
            data-testid="search-thread-group"
            selected={groupHasSelected}
          >
            <SearchThreadResultHeader>
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-foreground-muted ">
                <Badge appearance="outline">
                  <ThreadIcon width={11} height={11} />
                  {formatMessage({ id: "search.threadBadge" })}
                </Badge>
                <SearchThreadResultMeta>{sourceLabel}</SearchThreadResultMeta>
                <span>
                  {formatMessage(
                    { id: "search.hitsCount" },
                    { count: group.hitCount },
                  )}
                </span>
                <SearchThreadResultTimestamp>
                  {(() => {
                    const parts = getSearchRelativeTimeParts(
                      group.latestCreatedAt,
                    );
                    return parts
                      ? formatRelativeTimeParts(
                          parts.value,
                          parts.unit,
                          intl.locale,
                        )
                      : formatMessage({ id: "search.grpUnknownTime" });
                  })()}
                </SearchThreadResultTimestamp>
              </div>
              <SearchThreadResultTitle>
                {group.title ||
                  formatMessage({ id: "search.grpThreadDiscussion" })}
              </SearchThreadResultTitle>
            </SearchThreadResultHeader>
            <SearchThreadResultMessages>
              {group.results.map((result) => renderMessageHit(result, true))}
            </SearchThreadResultMessages>
          </SearchThreadResult>
        );
      })}
    </>
  );
}
