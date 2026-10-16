import type { ReactNode } from "react";
import { useIntl } from "react-intl";
import { Search } from "lucide-react";
import {
  Kbd,
  SearchEntityResult,
  SearchEntityResultLeading,
  SearchEntityResultIcon,
  SearchEntityResultContent,
  SearchEntityResultHeader,
  SearchEntityResultTitle,
  SearchEntityResultDescription,
} from "raft-ui";
export default function OverlayAllResults({
  query,
  onOpen,
  selected,
  children,
}: {
  selected: boolean;
  children?: ReactNode;
  query: string;
  onOpen: () => void;
}) {
  const { formatMessage } = useIntl();
  return (
    <div className="p-4">
      <div
        className="mb-3 flex flex-col gap-2"
        data-testid="search-overlay-head"
      >
        {children}
        <SearchEntityResult
          type="button"
          data-testid="search-view-all-results"
          data-search-rail-id="$all"
          selected={selected}
          onClick={onOpen}
        >
          <SearchEntityResultLeading>
            <SearchEntityResultIcon>
              <Search size={14} />
            </SearchEntityResultIcon>
          </SearchEntityResultLeading>
          <SearchEntityResultContent>
            <SearchEntityResultHeader>
              <SearchEntityResultTitle>
                {query.trim()
                  ? formatMessage(
                      { id: "search.overlay.searchFor" },
                      { query: query.trim() },
                    )
                  : formatMessage({ id: "search.overlay.viewAllResults" })}
              </SearchEntityResultTitle>
            </SearchEntityResultHeader>
            <SearchEntityResultDescription>
              {formatMessage({ id: "search.overlay.viewAllResultsHint" })}
            </SearchEntityResultDescription>
          </SearchEntityResultContent>
          <Kbd aria-hidden>↵</Kbd>
        </SearchEntityResult>
      </div>
    </div>
  );
}
