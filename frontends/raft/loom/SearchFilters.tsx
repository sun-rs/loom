import { isSearchKeyboardComposing } from "../packages/web/src/components/search/searchComposition.ts";
import { useSearchPresentation as useSearchParams } from "./useSearchPresentation.ts";
import type { RahClient } from "@rah-os/client-sdk";
import type { Principal, Room } from "@rah-os/protocol";
import { changeNativeSearchFilter } from "./native-search.ts";
import SearchIdentityFilter from "./SearchIdentityFilter.tsx";
import { useEffect, useRef, useState } from "react";
import { useIntl, type IntlShape } from "react-intl";
import { ArrowDownUp, AtSign, CalendarRange, ChevronDown } from "lucide-react";
import {
  Button,
  SearchShellFilters,
  PickerTriggerButton,
  Select,
  SelectTrigger,
  SelectIcon,
  SelectContent,
  SelectList,
  SelectGroup,
  SelectGroupLabel,
  SelectSeparator,
  SelectItem,
  SelectItemText,
  SelectItemIndicator,
} from "raft-ui";
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

function getScopeChipLabel(
  scopes: readonly SearchScope[],
  formatMessage: IntlShape["formatMessage"],
): string {
  return scopes.length > 0
    ? formatMessage({ id: "search.scopeChip" }, { count: scopes.length })
    : formatMessage({ id: "search.scope" });
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
export default function SearchFilters({
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
  const activeFilterClass =
    "border-line-strong bg-primary-soft text-foreground-strong shadow-raft-sm theme-brutal:border-2 theme-brutal:border-black theme-brutal:bg-soft-signal theme-brutal:text-black theme-brutal:shadow-brutal-sm";
  const identityProps = {
    ...directory,
    params,
    update,
    openFilterMenu,
    setOpenFilterMenu,
    filtersPortalRef,
    activeFilterClass,
  };
  return (
    <SearchShellFilters
      className={overlay ? "px-3 py-2" : undefined}
      ref={filtersPortalRef}
      onKeyDown={(event) => {
        // Native SearchOverlay respects defaultPrevented: dismiss the inner filter only.
        if (
          event.key === "Escape" &&
          openFilterMenu &&
          !isSearchKeyboardComposing(event)
        ) {
          event.preventDefault();
          event.stopPropagation();
          setOpenFilterMenu(null);
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SearchIdentityFilter
          kind="from"
          {...identityProps}
          disabled={directoryState !== "ready"}
        />
        <Select<SearchScope, true>
          multiple
          open={openFilterMenu === "scope"}
          onOpenChange={handleScopeMenuOpenChange}
          items={scopeItems}
          value={scopeValue}
          onValueChange={setScopeFilters}
        >
          <SelectTrigger
            aria-label={formatMessage({ id: "search.scope" })}
            render={
              <PickerTriggerButton
                className={scopes.length > 0 ? activeFilterClass : undefined}
              />
            }
          >
            <AtSign aria-hidden size={14} />
            <span>{getScopeChipLabel(scopes, formatMessage)}</span>
            <SelectIcon>
              <ChevronDown aria-hidden size={12} />
            </SelectIcon>
          </SelectTrigger>
          <SelectContent align="start" portalProps={filtersPortalProps}>
            <SelectList>
              <SelectGroup>
                <SelectGroupLabel>
                  {formatMessage({ id: "search.scope" })}
                </SelectGroupLabel>
                <SelectSeparator />
                {SEARCH_SCOPE_OPTIONS.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    <SelectItemText>
                      {formatMessage({ id: getScopeOptionLabelId(mode) })}
                    </SelectItemText>
                    <SelectItemIndicator />
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectList>
          </SelectContent>
        </Select>
        <SearchIdentityFilter
          kind="channel"
          {...identityProps}
          disabled={directoryState !== "ready"}
        />
        <Select<SearchTimeRange>
          open={openFilterMenu === "time"}
          onOpenChange={handleTimeMenuOpenChange}
          items={timeRangeItems}
          value={timeRange}
          onValueChange={handleTimeRangeChange}
        >
          <SelectTrigger
            aria-label={formatMessage({ id: "search.time" })}
            render={
              <PickerTriggerButton
                className={timeRange !== "any" ? activeFilterClass : undefined}
              />
            }
          >
            <CalendarRange aria-hidden size={14} />
            <span>{formatMessage({ id: getTimeRangeLabelId(timeRange) })}</span>
            <SelectIcon>
              <ChevronDown aria-hidden size={12} />
            </SelectIcon>
          </SelectTrigger>
          <SelectContent align="start" portalProps={filtersPortalProps}>
            <SelectList>
              <SelectGroup>
                <SelectGroupLabel>
                  {formatMessage({ id: "search.time" })}
                </SelectGroupLabel>
                <SelectSeparator />
                {SEARCH_TIME_RANGES.map((range) => (
                  <SelectItem key={range} value={range}>
                    <SelectItemText>
                      {formatMessage({ id: getTimeRangeLabelId(range) })}
                    </SelectItemText>
                    <SelectItemIndicator />
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectList>
          </SelectContent>
        </Select>
        <Select<SearchSort>
          disabled={!query.trim()}
          open={openFilterMenu === "sort"}
          onOpenChange={handleSortMenuOpenChange}
          items={sortItems}
          value={sort}
          onValueChange={handleSortChange}
        >
          <SelectTrigger
            aria-label={formatMessage({ id: "search.sort" })}
            data-testid="search-sort-chip"
            render={
              <PickerTriggerButton
                className={sort !== "relevance" ? activeFilterClass : undefined}
              />
            }
          >
            <ArrowDownUp aria-hidden size={14} />
            <span>
              {sort === "recent"
                ? formatMessage({ id: "search.sortRecent" })
                : formatMessage({ id: "search.sortRelevant" })}
            </span>
            <SelectIcon>
              <ChevronDown aria-hidden size={12} />
            </SelectIcon>
          </SelectTrigger>
          <SelectContent align="start" portalProps={filtersPortalProps}>
            <SelectList>
              <SelectGroup>
                <SelectGroupLabel>
                  {formatMessage({ id: "search.sort" })}
                </SelectGroupLabel>
                <SelectSeparator />
                {SEARCH_SORTS.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    <SelectItemText>
                      {mode === "relevance"
                        ? formatMessage({ id: "search.sortRelevant" })
                        : formatMessage({ id: "search.sortRecent" })}
                    </SelectItemText>
                    <SelectItemIndicator />
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectList>
          </SelectContent>
        </Select>
        {(params.has("senderId") ||
          params.has("channelId") ||
          scopes.length > 0 ||
          timeRange !== "any") && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => update("clear", "")}
          >
            {formatMessage({ id: "search.clearAll" })}
          </Button>
        )}
      </div>
      {directoryState === "error" && (
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
      )}
    </SearchShellFilters>
  );
}
