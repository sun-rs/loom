import { SearchGroupedMessages } from "./OfficialSearchSections.generated";
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
  const groups = groupSearchRows(rows);
  const selected = rows.find((row) => row.message.messageId === selectedId);
  return (
    <SearchGroupedMessages
      groupedMessageResults={groups}
      renderMessageHit={renderMessageHit}
      getSourceLabel={(result) => result.row.roomName}
      selectedResultKey={selected ? `message:${selected.id}` : null}
    />
  );
}
