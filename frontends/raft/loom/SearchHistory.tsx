import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { Badge } from "raft-ui";
import { Clock3, X } from "lucide-react";
import SectionEyebrow from "../packages/web/src/components/ui/SectionEyebrow.tsx";
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
    <div className="p-4" data-testid="search-home">
      <section className="mb-6" aria-labelledby="search-history-heading">
        <div className="mb-2 flex items-center justify-between gap-3 px-1">
          <SectionEyebrow as="div" className="flex items-center gap-1.5">
            <Clock3 size={12} aria-hidden="true" />
            <span id="search-history-heading">
              {formatMessage({ id: "search.history" })}
            </span>
          </SectionEyebrow>
          <div className="flex items-center gap-3">
            {isTouchSearchHome ? (
              <button
                type="button"
                onClick={() =>
                  setSearchHistoryEditRequested((editing) => !editing)
                }
                className="text-[11px] font-bold text-foreground-muted hover:text-foreground-strong theme-brutal:text-black/45 theme-brutal:hover:text-black"
                data-testid="search-history-edit-toggle"
              >
                {formatMessage({
                  id: searchHistoryEditing
                    ? "search.doneEditHistory"
                    : "search.editHistory",
                })}
              </button>
            ) : null}
            <button
              type="button"
              onClick={clearSearchHistory}
              className="text-[11px] font-bold text-foreground-muted hover:text-foreground-strong theme-brutal:text-black/45 theme-brutal:hover:text-black"
            >
              {formatMessage({ id: "search.clearHistory" })}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2" data-testid="search-history-tags">
          {searchHistory.map((historyQuery) => (
            <Badge
              key={historyQuery.toLocaleLowerCase()}
              render={<div />}
              appearance="outline"
              className="group relative hover:bg-fill-muted focus-within:bg-fill-muted"
              data-testid="search-history-tag"
            >
              <button
                type="button"
                onClick={() => chooseSearchHistoryEntry(historyQuery)}
                className="flex min-w-0 items-center gap-1 text-left after:absolute after:inset-0"
              >
                <Clock3 size={11} aria-hidden="true" />
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
                      ? "relative z-10 -my-1 -mr-1 flex shrink-0 items-center justify-center p-1"
                      : "pointer-events-none relative z-10 -my-1 -mr-1 flex shrink-0 items-center justify-center p-1 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus:pointer-events-auto focus:opacity-100"
                  }
                  aria-label={formatMessage(
                    { id: "search.removeHistory" },
                    { query: historyQuery },
                  )}
                >
                  <X size={11} aria-hidden="true" />
                </button>
              ) : null}
            </Badge>
          ))}
        </div>
      </section>
    </div>
  );
}
