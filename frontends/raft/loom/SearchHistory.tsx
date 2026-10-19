import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { Badge, SearchResultsSectionHeading } from "raft-ui";
import { Clock3, X } from "lucide-react";
import TextLink from "../packages/web/src/components/ui/TextLink.tsx";
import { useMediaQuery } from "../packages/web/src/hooks/effectPrimitives.ts";
import {
  addSearchHistoryEntry,
  getSearchHistoryStorageKey,
  persistSearchHistory,
  readSearchHistory,
  removeSearchHistoryEntry,
  resolveSearchHistoryEditing,
  shouldRenderSearchHistoryRemove,
} from "../packages/web/src/components/search/searchHome.ts";
function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
const HISTORY_CHANGED = "loom:search-history-changed";
/** Direct reuse of native normalization, scope, 15-entry limit and fail-open storage. */
export function useSearchHistory(workspaceId: string, principalId?: string) {
  const key = getSearchHistoryStorageKey(workspaceId, principalId);
  const [entries, setEntries] = useState(() =>
    readSearchHistory(storage(), key),
  );
  useEffect(() => {
    setEntries(readSearchHistory(storage(), key));
    // Overlay and background page can coexist. Share presentation updates only;
    // keep the native scoped storage as the persistent history owner.
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; entries: string[] }>)
        .detail;
      if (detail.key === key) setEntries(detail.entries);
    };
    window.addEventListener(HISTORY_CHANGED, changed);
    return () => window.removeEventListener(HISTORY_CHANGED, changed);
  }, [key]);
  const change = (update: (current: string[]) => string[]) => {
    const next = update(entries);
    persistSearchHistory(storage(), key, next);
    setEntries(next);
    window.dispatchEvent(
      new CustomEvent(HISTORY_CHANGED, { detail: { key, entries: next } }),
    );
  };
  return {
    entries,
    remember: (query: string) => {
      if (key) change((current) => addSearchHistoryEntry(current, query));
    },
    remove: (query: string) =>
      change((current) => removeSearchHistoryEntry(current, query)),
    clear: () => change(() => []),
  };
}
/** Structural port of MessageSearchPage's search-history section; original classes/labels. */
export default function SearchHistory({
  history,
  onChoose,
}: {
  history: ReturnType<typeof useSearchHistory>;
  onChoose: (query: string) => void;
}) {
  const { formatMessage } = useIntl();
  const searchHistory = history.entries;
  const isTouchSearchHome = useMediaQuery("(max-width: 767px)");
  const [searchHistoryEditRequested, setSearchHistoryEditRequested] =
    useState(false);
  const searchHistoryEditing = resolveSearchHistoryEditing({
    isTouchViewport: isTouchSearchHome,
    editRequested: searchHistoryEditRequested,
    historyCount: searchHistory.length,
  });
  const clearSearchHistory = () => {
    history.clear();
    setSearchHistoryEditRequested(false);
  };
  const forgetSearchQuery = (query: string) => {
    history.remove(query);
    if (searchHistory.length === 1) setSearchHistoryEditRequested(false);
  };
  const chooseSearchHistoryEntry = onChoose;
  return (
    <>
      <section aria-labelledby="search-history-heading">
        <div className="flex items-center justify-between gap-3 pr-4">
          <SearchResultsSectionHeading>
            <Clock3 size={14} aria-hidden="true" />
            <span id="search-history-heading">
              {formatMessage({ id: "search.history" })}
            </span>
          </SearchResultsSectionHeading>
          <div className="flex items-center gap-4 pt-5 pb-2">
            {isTouchSearchHome ? (
              <TextLink
                variant="primary"
                onClick={() =>
                  setSearchHistoryEditRequested((editing) => !editing)
                }
                className="text-footnote"
                data-testid="search-history-edit-toggle"
              >
                {formatMessage({
                  id: searchHistoryEditing
                    ? "search.doneEditHistory"
                    : "search.editHistory",
                })}
              </TextLink>
            ) : null}
            <TextLink
              variant="primary"
              onClick={clearSearchHistory}
              className="text-footnote"
            >
              {formatMessage({ id: "search.clearHistory" })}
            </TextLink>
          </div>
        </div>
        <div
          className="flex flex-wrap gap-1.5 px-4"
          data-testid="search-history-tags"
        >
          {searchHistory.map((historyQuery) => (
            <Badge
              key={historyQuery.toLocaleLowerCase()}
              render={<div />}
              appearance="soft"
              className="group relative hover:press-overlay focus-within:shadow-raft-focus"
              data-testid="search-history-tag"
            >
              <button
                type="button"
                onClick={() => chooseSearchHistoryEntry(historyQuery)}
                className="flex min-w-0 items-center gap-1 text-left outline-none after:absolute after:inset-0"
              >
                <Clock3 size={14} aria-hidden="true" />
                <span className="truncate">{historyQuery}</span>
              </button>
              {shouldRenderSearchHistoryRemove({
                isTouchViewport: isTouchSearchHome,
                editing: searchHistoryEditing,
              }) ? (
                <button
                  type="button"
                  onClick={() => forgetSearchQuery(historyQuery)}
                  className={
                    searchHistoryEditing
                      ? "relative z-10 -my-1 -mr-1 flex size-5.5 shrink-0 items-center justify-center rounded-sticker text-foreground-hint hover:bg-fill-pressed"
                      : "pointer-events-none relative z-10 -my-1 -mr-1 flex size-5.5 shrink-0 items-center justify-center rounded-sticker text-foreground-hint hover:bg-fill-pressed opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus:pointer-events-auto focus:opacity-100"
                  }
                  aria-label={formatMessage(
                    { id: "search.removeHistory" },
                    { query: historyQuery },
                  )}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              ) : null}
            </Badge>
          ))}
        </div>
      </section>
    </>
  );
}
