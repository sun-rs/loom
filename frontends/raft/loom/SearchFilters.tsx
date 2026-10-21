import { isSearchKeyboardComposing } from "../packages/web/src/components/search/searchComposition.ts";
import { useSearchPresentation as useSearchParams } from "./useSearchPresentation.ts";
import type { RahClient } from "@rah-os/client-sdk";
import type { Principal, Room } from "@rah-os/protocol";
import { changeNativeSearchFilter } from "./native-search.ts";
import SearchIdentityFilter from "./SearchIdentityFilter.tsx";
import { useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { Button } from "raft-ui";
import { OfficialSearchFilters } from "./OfficialSearchControls.generated";
import {
  normalizeSearchScopes,
  normalizeSearchSort,
  normalizeSearchTimeRange,
  type SearchScope,
  type SearchSort,
  type SearchTimeRange,
} from "../packages/web/src/components/search/searchGrouping.ts";
const SEARCH_SCOPE_OPTIONS = ["mentioned", "humans", "agents"] as const;
const SEARCH_TIME_RANGES = ["any", "today", "7d", "30d"] as const;
const SEARCH_SORTS = ["relevance", "recent"] as const;
function getScopeOptionLabelId(
  scope: SearchScope,
): "search.scopeMe" | "search.scopeHumans" | "search.scopeAgents" {
  switch (scope) {
    case "mentioned":
      return "search.scopeMe";
    case "humans":
      return "search.scopeHumans";
    case "agents":
      return "search.scopeAgents";
  }
}

function getTimeRangeLabelId(
  range: SearchTimeRange,
):
  | "search.timeToday"
  | "search.timeLast7"
  | "search.timeLast30"
  | "search.timeAny" {
  switch (range) {
    case "today":
      return "search.timeToday";
    case "7d":
      return "search.timeLast7";
    case "30d":
      return "search.timeLast30";
    default:
      return "search.timeAny";
  }
}
/** Native MessageSearchPage filter controls with authenticated Loom directory data. */
export function useSearchFilterController({
  params,
  query,
  client,
  workspaceId,
  overlay = false,
}: {
  overlay?: boolean;
  params: URLSearchParams;
  query: string;
  client: RahClient;
  workspaceId: string;
}) {
  const { formatMessage } = useIntl();
  const [, setParams] = useSearchParams();
  const [directory, setDirectory] = useState<{
    principals: Principal[];
    rooms: Room[];
    selfId?: string;
  }>({ principals: [], rooms: [] });
  const [directoryState, setDirectoryState] = useState("loading");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setDirectory({ principals: [], rooms: [] });
    setDirectoryState("loading");
    void Promise.all([
      client.request(
        "search",
        { workspaceId, query: "", limit: 1 },
        { signal: controller.signal },
      ),
      client.request("principal.me", {}, { signal: controller.signal }),
    ])
      .then(([data, identity]) => {
        if (!controller.signal.aborted) {
          setDirectory({ ...data, selfId: identity.principal.principalId });
          setDirectoryState("ready");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setDirectoryState("error");
      });
    return () => controller.abort();
  }, [client, workspaceId, retry]);
  const update = (key: string, value: string) =>
    setParams((previous) =>
      changeNativeSearchFilter(
        previous,
        key,
        value,
        new Map(directory.principals.map((p) => [p.principalId, p.kind])),
      ),
    );

  const filtersPortalRef = useRef<HTMLDivElement>(null);
  const filtersPortalProps = { container: filtersPortalRef };
  const [openFilterMenu, setOpenFilterMenu] = useState<string | null>(null);
  const scopes = normalizeSearchScopes((params.get("scopes") ?? "").split(","));
  const scopeValue = [...scopes];
  const sort = normalizeSearchSort(params.get("sort"));
  const timeRange = normalizeSearchTimeRange(params.get("range"));
  const scopeItems = SEARCH_SCOPE_OPTIONS.map((value) => ({
    value,
    label: formatMessage({ id: getScopeOptionLabelId(value) }),
  }));
  const timeRangeItems = SEARCH_TIME_RANGES.map((value) => ({
    value,
    label: formatMessage({ id: getTimeRangeLabelId(value) }),
  }));
  const sortItems = SEARCH_SORTS.map((value) => ({
    value,
    label: formatMessage({
      id: value === "recent" ? "search.sortRecent" : "search.sortRelevant",
    }),
  }));
  const handleScopeMenuOpenChange = (open: boolean) =>
    setOpenFilterMenu(open ? "scope" : null);
  const handleTimeMenuOpenChange = (open: boolean) =>
    setOpenFilterMenu(open ? "time" : null);
  const handleSortMenuOpenChange = (open: boolean) =>
    setOpenFilterMenu(open ? "sort" : null);
  const setScopeFilters = (values: SearchScope[]) =>
    update("scopes", normalizeSearchScopes(values).join(","));
  const handleTimeRangeChange = (value: SearchTimeRange | null) => {
    if (value) update("range", value === "any" ? "" : value);
  };
  const handleSortChange = (value: SearchSort | null) => {
    if (value) update("sort", value === "relevance" ? "" : value);
  };
  const identityProps = {
    ...directory,
    params,
    update,
    openFilterMenu,
    setOpenFilterMenu,
    filtersPortalRef,
  };
  return {
    query,
    overlayChrome: overlay,
    filtersPortalRef,
    filtersPortalProps,
    openFilterMenu,
    scopes,
    scopeValue,
    sort,
    timeRange,
    scopeItems,
    timeRangeItems,
    sortItems,
    handleScopeMenuOpenChange,
    handleTimeMenuOpenChange,
    handleSortMenuOpenChange,
    setScopeFilters,
    handleTimeRangeChange,
    handleSortChange,
    hasActiveFilters:
      params.has("senderId") ||
      params.has("channelId") ||
      scopes.length > 0 ||
      timeRange !== "any",
    clearAllFilters: () => update("clear", ""),
    handleFilterKeyDown: (
      event: import("react").KeyboardEvent<HTMLDivElement>,
    ) => {
      if (
        event.key === "Escape" &&
        openFilterMenu &&
        !isSearchKeyboardComposing(event)
      ) {
        event.preventDefault();
        event.stopPropagation();
        setOpenFilterMenu(null);
      }
    },
    senderSlot: (
      <SearchIdentityFilter
        kind="from"
        {...identityProps}
        disabled={directoryState !== "ready"}
      />
    ),
    channelSlot: (
      <SearchIdentityFilter
        kind="channel"
        {...identityProps}
        disabled={directoryState !== "ready"}
      />
    ),
    directoryError:
      directoryState === "error" ? (
        <div role="alert">
          筛选项读取失败。
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setRetry((v) => v + 1)}
          >
            重试
          </Button>
        </div>
      ) : null,
  };
}
export default function SearchFilters(
  props: Parameters<typeof useSearchFilterController>[0],
) {
  return <OfficialSearchFilters {...useSearchFilterController(props)} />;
}
