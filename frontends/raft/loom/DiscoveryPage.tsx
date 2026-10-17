import ActivityEmpty from "./ActivityEmpty.tsx";
import { ConversationCardSkeleton } from "../packages/web/src/components/ui/Skeleton.tsx";
import { useActivityFeed } from "./useActivityFeed.ts";
import { useIntl } from "react-intl";
import SearchFrequent, {
  useSearchFrequent,
  rememberSearchDestination,
} from "./SearchFrequent.tsx";
import SearchHistory, { useSearchHistory } from "./SearchHistory.tsx";
import { useActivityScroll } from "./useActivityScroll.ts";
import SearchRecent, { useSearchRecent } from "./SearchRecent.tsx";
import SearchEntityRows, { SearchEntityRow } from "./SearchEntityRows.tsx";
import { useSearchEntities } from "./useSearchEntities.ts";
import type { SearchEntity } from "./search-entities.ts";
import SearchLoadMore from "./SearchLoadMore.tsx";
import { appendSearchPage, MAX_SEARCH_RESULT_ROWS } from "./search-pages.ts";
import { useSearchRail, type SearchRailHandler } from "./useSearchRail.ts";
import type { RefObject } from "react";
import OverlayAllResults from "./OverlayAllResults.tsx";
import { useResizablePanel } from "../packages/web/src/hooks/useResizablePanel.ts";
import { useMediaQuery } from "../packages/web/src/hooks/effectPrimitives.ts";
import { MASTER_DETAIL_COMPACT_PANEL_BOUNDS } from "../packages/web/src/components/layout/masterDetailPanelSizing.ts";
import PanelResizeHandle from "../packages/web/src/components/ui/PanelResizeHandle.tsx";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchPresentation as useSearchParams } from "./useSearchPresentation.ts";
import {
  AppShellMainSlot,
  Button,
  Spinner,
  SearchShellRoot,
  ActivityInboxPanel,
  SearchShellViewport,
  SearchResultsSummary,
  SearchResultsList,
} from "raft-ui";
import { Activity } from "lucide-react";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  WorkspaceSearchRequest,
  HumanActivityRequest,
} from "@rah-os/protocol";
import PanelHeader from "../packages/web/src/components/ui/PanelHeader.tsx";
import SearchFilters from "./SearchFilters.tsx";
import { nativeSearchFilters } from "./native-search.ts";
import {
  searchPage,
  type DiscoveryPageResult,
  type DiscoveryRow,
} from "./discovery-client.ts";
import ActivityFilters from "./ActivityFilters.tsx";
import ActivityMessageRow from "./ActivityMessageRow.tsx";
import SearchHeader from "./SearchHeader.tsx";
import SearchMessageGroups from "./SearchMessageGroups.tsx";
export default function DiscoveryPage({
  client,
  workspaceId,
  controlRoomId,
  principalId,
  backgroundRoomId,
  onOpenEntity,
  mode,
  onOpenResult,
  detail,
  profileOpen = false,
  notice,
  onBack,
  overlay = false,
}: {
  onOpenResult: (row: DiscoveryRow, full: boolean) => Promise<void>;
  overlay?: boolean;
  notice?: ReactNode;
  detail?: ReactNode;
  profileOpen?: boolean;
  onBack: () => void;
  client: RahClient;
  workspaceId: string;
  controlRoomId?: string;
  principalId?: string;
  backgroundRoomId?: string;
  onOpenEntity: (entity: SearchEntity, full: boolean) => Promise<void>;
  mode: "search" | "activity";
}) {
  const [params, setParams] = useSearchParams();
  const railHandler = useRef<SearchRailHandler>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const history = useSearchHistory(workspaceId, principalId);
  const allResults = () => {
    history.remember(params.get("q") ?? "");
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("presentation", "page");
        return next;
      },
      { state: null },
    );
  };
  const desktop = useMediaQuery("(min-width: 768px)");
  const wide = useMediaQuery("(min-width: 1024px)");
  const fullPanel = useResizablePanel({
    storageKey: "loom:activityPanelWidth",
    min: 400,
    max: 720,
    defaultWidth: 560,
  });
  const compactPanel = useResizablePanel({
    storageKey: "loom:activityCompactWidth",
    ...MASTER_DETAIL_COMPACT_PANEL_BOUNDS,
  });
  const panel =
    !wide ||
    profileOpen ||
    (params.has("thread") && params.get("detail") !== "thread")
      ? compactPanel
      : fullPanel;
  const query = params.get("q") ?? "";
  const entities = useSearchEntities(
    client,
    workspaceId,
    controlRoomId,
    query,
    mode === "search",
  );
  const frequent = useSearchFrequent(entities, workspaceId, principalId);
  const recent = useSearchRecent(
    entities,
    workspaceId,
    principalId,
    backgroundRoomId,
  );
  const scope: WorkspaceSearchRequest["scope"] = [
    "channel",
    "direct",
    "thread",
  ].includes(params.get("scope") ?? "")
    ? (params.get("scope") as WorkspaceSearchRequest["scope"])
    : "all";
  const filter: HumanActivityRequest["filter"] = [
    "unread",
    "mentions",
  ].includes(params.get("af") ?? "")
    ? (params.get("af") as HumanActivityRequest["filter"])
    : "all";
  const filterKey = [
    params.get("senderId"),
    params.get("channelId"),
    params.get("scopes"),
    params.get("range"),
    params.get("sort"),
  ].join("|");
  const searchFilters = useMemo(
    () => nativeSearchFilters(params, query),
    [filterKey, query],
  );
  const [tick, setTick] = useState(0);
  const update = (key: string, value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  const Shell = mode === "search" ? SearchShellRoot : ActivityInboxPanel;
  return (
    <>
      <AppShellMainSlot
        onKeyDown={
          mode === "search"
            ? (event) => railHandler.current?.(event)
            : undefined
        }
        className={`relative bg-layer-canvas theme-brutal:bg-white ${detail && desktop ? `border-r border-line-muted theme-brutal:border-black ${mode === "search" ? "theme-brutal:border-r-2" : ""}` : ""}`}
        style={
          detail
            ? desktop
              ? { flex: `0 0 ${panel.width}px`, width: panel.width }
              : { display: "none" }
            : undefined
        }
      >
        {detail && desktop && (
          <PanelResizeHandle
            side="right"
            visibleFrom="md"
            data-testid="activity-detail-resize"
            onPointerDown={panel.handleResizeStart}
            onPointerMove={panel.handleResizeMove}
            onPointerUp={panel.handleResizeEnd}
            onPointerCancel={panel.handleResizeEnd}
          />
        )}
        {mode === "search" ? (
          <SearchHeader
            inputRef={searchInput}
            overlay={overlay}
            query={query}
            onBack={onBack}
            onQuery={(value) =>
              setParams(
                (previous) => {
                  const next = new URLSearchParams(previous);
                  if (value) next.set("q", value);
                  else next.delete("q");
                  return next;
                },
                { replace: true },
              )
            }
            onEscape={() => {
              if (!detail) {
                onBack();
                return;
              }
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                for (const key of ["room", "message", "thread", "detail"])
                  next.delete(key);
                return next;
              });
            }}
          />
        ) : (
          <PanelHeader
            title="动态"
            icon={<Activity size={18} />}
            onMobileBack={onBack}
            mobileBackProps={{ "aria-label": "返回聊天列表" }}
          />
        )}
        {notice}
        <Shell edge="attached" className="min-h-0 flex-1 border-l-0">
          {mode === "search" ? (
            <SearchFilters
              overlay={overlay}
              params={params}
              query={query}
              client={client}
              workspaceId={workspaceId}
            />
          ) : (
            <ActivityFilters
              value={filter!}
              onChange={(value) => update("af", value)}
              onRefresh={() => setTick((v) => v + 1)}
            />
          )}
          <Results
            history={history}
            onChooseHistory={(query) => {
              update("q", query);
              requestAnimationFrame(() => {
                searchInput.current?.focus({ preventScroll: true });
                searchInput.current?.setSelectionRange(
                  query.length,
                  query.length,
                );
              });
            }}
            railHandler={railHandler}
            overlayHome={overlay ? allResults : undefined}
            key={`${mode}:${query}:${scope}:${filter}:${tick}:${filterKey}`}
            client={client}
            entities={entities}
            recent={recent}
            frequent={frequent}
            onOpenEntity={(entity, full) => {
              history.remember(query);
              return onOpenEntity(entity, full);
            }}
            workspaceId={workspaceId}
            principalId={principalId}
            mode={mode}
            query={query}
            searchFilters={searchFilters}
            scope={scope}
            filter={filter}
            tick={tick}
            onOpenResult={async (row, full) => {
              if (mode === "search") history.remember(query);
              await onOpenResult(row, full);
              if (mode === "search" && !row.rootMessageId) {
                const entity = entities.catalog.find(
                  (e) => e.suggestion.channelId === row.message.roomId,
                )?.suggestion;
                if (entity)
                  rememberSearchDestination(
                    workspaceId,
                    principalId,
                    entity.key,
                  );
              }
            }}
          />
        </Shell>
      </AppShellMainSlot>
      {detail}
    </>
  );
}
function Results({
  history,
  onChooseHistory,
  railHandler,
  overlayHome,
  client,
  workspaceId,
  principalId,
  entities,
  recent,
  frequent,
  onOpenEntity,
  mode,
  query,
  searchFilters,
  scope,
  filter,
  tick,
  onOpenResult,
}: {
  railHandler: RefObject<SearchRailHandler>;
  overlayHome?: () => void;
  history: ReturnType<typeof useSearchHistory>;
  onChooseHistory: (query: string) => void;
  onOpenResult: (row: DiscoveryRow, full: boolean) => Promise<void>;
  client: RahClient;
  workspaceId: string;
  principalId?: string;
  entities: ReturnType<typeof useSearchEntities>;
  recent: SearchEntity[];
  frequent: SearchEntity[];
  onOpenEntity: (entity: SearchEntity, full: boolean) => Promise<void>;
  mode: "search" | "activity";
  query: string;
  searchFilters: ReturnType<typeof nativeSearchFilters>;
  scope: WorkspaceSearchRequest["scope"];
  filter: HumanActivityRequest["filter"];
  tick: number;
}) {
  const [route] = useSearchParams();
  const { formatMessage } = useIntl();
  const [searchData, setData] = useState<DiscoveryPageResult>();
  const [searchLoading, setLoading] = useState(false);
  const [searchError, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const activity = useActivityFeed(
    client,
    workspaceId,
    filter,
    mode === "activity",
    retry,
    principalId,
  );
  const data = mode === "activity" ? activity.data : searchData;
  const loading = mode === "activity" ? activity.loading : searchLoading;
  const error =
    mode === "activity" ? activity.error || searchError : searchError;
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const activityScroll = useActivityScroll(
    client,
    JSON.stringify([principalId, workspaceId, filter]),
    mode === "activity",
    !loading && !error && Boolean(data?.rows.length),
    Boolean(principalId),
  );
  const moreRequest = useRef<AbortController | null>(null);
  const loadMoreResults = async () => {
    if (
      !data?.nextCursor ||
      moreRequest.current ||
      data.rows.length >= MAX_SEARCH_RESULT_ROWS
    )
      return;
    const controller = new AbortController();
    moreRequest.current = controller;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const next = await searchPage(
        client,
        {
          workspaceId,
          query,
          scope,
          ...searchFilters,
          limit: Math.min(20, MAX_SEARCH_RESULT_ROWS - data.rows.length),
          cursor: data.nextCursor,
        },
        controller.signal,
      );
      if (!controller.signal.aborted)
        setData((previous) =>
          previous ? appendSearchPage(previous, next) : previous,
        );
    } catch {
      if (!controller.signal.aborted) setLoadMoreError(true);
    } finally {
      if (moreRequest.current === controller) {
        moreRequest.current = null;
        setLoadingMore(false);
      }
    }
  };

  const pendingDone = useRef(new Set<string>());
  const [pendingRows, setPendingRows] = useState(new Set<string>());
  const [mutationError, setMutationError] = useState("");
  const markDone = async (row: DiscoveryRow) => {
    if (!row.activityFrontier || pendingDone.current.has(row.id)) return;
    pendingDone.current.add(row.id);
    setPendingRows(new Set(pendingDone.current));
    setMutationError("");
    try {
      await client.request("activity.mark", {
        roomId: row.message.roomId,
        ...row.activityFrontier,
        action: "done",
      });
    } catch {
      setMutationError(
        "未确认动态已完成，正在重新读取状态；不会自动重发操作。",
      );
    } finally {
      pendingDone.current.delete(row.id);
      setPendingRows(new Set(pendingDone.current));
      setRetry((value) => value + 1);
    }
  };
  useEffect(() => {
    if (mode !== "search") return;
    moreRequest.current?.abort();
    moreRequest.current = null;
    setLoadingMore(false);
    setLoadMoreError(false);
    const controller = new AbortController();
    setData(undefined);
    setError("");
    if (
      mode === "search" &&
      !query.trim() &&
      !searchFilters.senderIds?.length &&
      !searchFilters.roomIds?.length &&
      !searchFilters.senderKind &&
      !searchFilters.mentionSelf &&
      !searchFilters.after
    ) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(
      () => {
        const read = searchPage(
          client,
          { workspaceId, query, scope, ...searchFilters, limit: 20 },
          controller.signal,
        );
        void read
          .then((value) => {
            if (!controller.signal.aborted) setData(value);
          })
          .catch(() => {
            if (!controller.signal.aborted) setError("读取失败，请重试。");
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      mode === "search" ? 200 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
      moreRequest.current?.abort();
      moreRequest.current = null;
    };
  }, [
    client,
    workspaceId,
    mode,
    query,
    scope,
    searchFilters,
    filter,
    tick,
    retry,
  ]);
  // Native overlay previews five hits; full-page search owns pagination.
  const visibleRows = overlayHome
    ? (data?.rows ?? []).slice(0, 5)
    : (data?.rows ?? []);
  const showRecent =
    Boolean(overlayHome) &&
    !query.trim() &&
    !searchFilters.senderIds?.length &&
    !searchFilters.roomIds?.length &&
    !searchFilters.senderKind &&
    !searchFilters.mentionSelf &&
    !searchFilters.after &&
    recent.length > 0;
  const exact = overlayHome ? entities.exact : null;
  type RailRow =
    | { id: string; entity: SearchEntity }
    | { id: string; message: DiscoveryRow }
    | { id: string; home: true };
  const railRows: RailRow[] = showRecent
    ? recent.map((entity) => ({ id: entity.key, entity }))
    : [
        ...(exact ? [{ id: exact.key, entity: exact }] : []),
        ...(overlayHome ? [{ id: "$all", home: true as const }] : []),
        ...entities.results
          .filter((e) => e.key !== exact?.key)
          .map((entity) => ({ id: entity.key, entity })),
        ...visibleRows.map((message) => ({ id: message.id, message })),
      ];
  const openEntity = (entity: SearchEntity, full: boolean) => {
    void onOpenEntity(
      entity,
      Boolean(overlayHome) ||
        full ||
        !window.matchMedia("(min-width: 1024px)").matches,
    ).catch(() => setMutationError("无法打开此对话，请刷新后重试。"));
  };
  const rail = useSearchRail(
    railRows,
    mode === "search",
    railHandler,
    (row) => {
      if ("home" in row) overlayHome?.();
      else if ("entity" in row) openEntity(row.entity, false);
      else
        void onOpenResult(row.message, false).catch(() =>
          setError("无法打开消息，请刷新重试。"),
        );
    },
    route.get("message") ??
      (!overlayHome && route.has("room")
        ? entities.results.find((e) => e.channelId === route.get("room"))?.key
        : null) ??
      null,
    overlayHome ? query + "\0" + (exact?.key ?? "") : "page",
  );
  const selectEntity = (entity: SearchEntity, full: boolean) => {
    rail.select({ id: entity.key, entity });
    openEntity(entity, full);
  };
  const Viewport = mode === "activity" ? "div" : SearchShellViewport;
  const ResultList = mode === "activity" ? "div" : SearchResultsList;
  return (
    <Viewport
      ref={activityScroll.ref}
      onScroll={(event) => {
        activityScroll.onScroll();
        const target = event.currentTarget;
        // Native ThreadsInbox handleScroll threshold and loading guard.
        if (
          mode === "activity" &&
          target.scrollHeight - target.scrollTop - target.clientHeight < 240
        )
          void activity.loadMore();
      }}
      data-testid="discovery-results"
      className={
        mode === "activity"
          ? "scrollbar-quiet relative flex-1 overflow-y-overlay bg-layer-canvas-muted p-4 safe-bottom theme-brutal:bg-white"
          : "min-h-0 overflow-y-auto"
      }
    >
      {showRecent && (
        <SearchRecent
          entities={recent}
          selectedId={rail.selectedId}
          onOpen={selectEntity}
        />
      )}
      {overlayHome && !showRecent && (
        <OverlayAllResults
          query={query}
          onOpen={overlayHome}
          selected={rail.selectedId === "$all"}
        >
          {exact && (
            <SearchEntityRow
              entity={exact}
              selected={rail.selectedId === exact.key}
              onOpen={selectEntity}
            />
          )}
        </OverlayAllResults>
      )}
      <SearchEntityRows
        entities={entities.results.filter((e) => e.key !== exact?.key)}
        selectedId={rail.selectedId}
        onOpen={selectEntity}
      />
      {entities.error && (
        <div role="alert" className="p-3">
          对话目录读取失败。
          <Button onClick={entities.retry}>重新读取目录</Button>
        </div>
      )}
      {mutationError && (
        <p role="alert" className="px-3 py-2">
          {mutationError}
        </p>
      )}
      {showRecent ? null : mode === "search" &&
        !query.trim() &&
        !searchFilters.senderIds?.length &&
        !searchFilters.roomIds?.length &&
        !searchFilters.senderKind &&
        !searchFilters.mentionSelf &&
        !searchFilters.after ? (
        !overlayHome && (history.entries.length || frequent.length) ? (
          <div className="p-4" data-testid="search-home">
            {history.entries.length > 0 && (
              <SearchHistory history={history} onChoose={onChooseHistory} />
            )}
            <SearchFrequent entities={frequent} onOpen={openEntity} />
          </div>
        ) : (
          <p className="p-4">输入关键词搜索可访问的消息。</p>
        )
      ) : loading ? (
        mode === "activity" ? (
          <ConversationCardSkeleton />
        ) : (
          <Spinner aria-label="正在读取结果" />
        )
      ) : error ? (
        <div role="alert" className="p-4">
          {error}
          <Button onClick={() => setRetry((v) => v + 1)}>重新读取</Button>
        </div>
      ) : (
        data && (
          <>
            {mode === "search" && (
              <SearchResultsSummary>
                {data.total} 条匹配消息
              </SearchResultsSummary>
            )}
            <ResultList
              className={
                mode === "activity"
                  ? data.rows.length
                    ? "flex flex-col gap-2"
                    : "h-full"
                  : "p-3"
              }
            >
              {!data.rows.length ? (
                mode === "activity" ? (
                  <ActivityEmpty filter={filter} />
                ) : (
                  <p>没有匹配结果</p>
                )
              ) : mode === "search" ? (
                <SearchMessageGroups
                  rows={visibleRows}
                  query={query}
                  selectedId={rail.selectedId}
                  onOpen={(row, full) => {
                    rail.select({ id: row.id, message: row });
                    void onOpenResult(row, full).catch(() =>
                      setError("无法打开消息，请刷新重试。"),
                    );
                  }}
                />
              ) : (
                data.rows.map((row) => (
                  <ActivityMessageRow
                    pending={pendingRows.has(row.id)}
                    onDone={() => {
                      void markDone(row);
                    }}
                    key={row.id}
                    row={row}
                    active={route.get("message") === row.message.messageId}
                    onOpen={(full) => {
                      void onOpenResult(row, full).catch(() =>
                        setError("无法打开消息，请刷新重试。"),
                      );
                    }}
                  />
                ))
              )}
            </ResultList>
            {mode === "search" ? (
              !overlayHome &&
              data.nextCursor &&
              (data.rows.length >= MAX_SEARCH_RESULT_ROWS ? (
                <SearchResultsSummary>
                  已显示 {MAX_SEARCH_RESULT_ROWS}{" "}
                  条结果，请缩小搜索范围查看其余消息。
                </SearchResultsSummary>
              ) : (
                <SearchLoadMore
                  loadingMore={loadingMore}
                  loadMoreError={loadMoreError}
                  loadMoreResults={() => {
                    void loadMoreResults();
                  }}
                />
              ))
            ) : (
              <>
                {activity.loadingMore && (
                  <div className="py-3 text-center text-xs font-bold text-foreground-muted">
                    {formatMessage({ id: "thread.loadingMore" })}
                  </div>
                )}
                {activity.moreError && (
                  <p
                    role="alert"
                    className="px-4 py-3 text-xs text-foreground-muted"
                  >
                    读取更多动态失败，已保留当前列表；请使用“刷新动态”重试。
                  </p>
                )}
                {activity.atLimit && data.nextCursor && (
                  <p className="px-4 py-3 text-xs text-foreground-muted">
                    已达到当前列表窗口上限，请缩小动态筛选范围。
                  </p>
                )}
              </>
            )}
          </>
        )
      )}
    </Viewport>
  );
}
