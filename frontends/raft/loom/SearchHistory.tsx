import { useEffect, useState } from "react";
import { SearchHistorySection } from "./OfficialSearchSections.generated";
import { useMediaQuery } from "../packages/web/src/hooks/effectPrimitives.ts";
import {
  addSearchHistoryEntry,
  getSearchHistoryStorageKey,
  persistSearchHistory,
  readSearchHistory,
  removeSearchHistoryEntry,
  resolveSearchHistoryEditing,
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
    <SearchHistorySection
      searchHistory={searchHistory}
      isTouchSearchHome={isTouchSearchHome}
      searchHistoryEditing={searchHistoryEditing}
      toggleSearchHistoryEdit={() =>
        setSearchHistoryEditRequested((editing) => !editing)
      }
      clearSearchHistory={clearSearchHistory}
      chooseSearchHistoryEntry={chooseSearchHistoryEntry}
      forgetSearchQuery={forgetSearchQuery}
    />
  );
}
