import { useResizablePanel } from "../packages/web/src/hooks/useResizablePanel.ts";
import { useMediaQuery } from "../packages/web/src/hooks/effectPrimitives.ts";
import { MASTER_DETAIL_COMPACT_PANEL_BOUNDS } from "../packages/web/src/components/layout/masterDetailPanelSizing.ts";
import PanelResizeHandle from "../packages/web/src/components/ui/PanelResizeHandle.tsx";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
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
  activityPage,
  type DiscoveryPageResult,
  type DiscoveryRow,
} from "./discovery-client.ts";
import ActivityFilters from "./ActivityFilters.tsx";
import ActivityMessageRow from "./ActivityMessageRow.tsx";
import SearchHeader from "./SearchHeader.tsx";
import SearchMessageRow from "./SearchMessageRow.tsx";
export default function DiscoveryPage({
  client,
  workspaceId,
  mode,
  onOpenResult,
  detail,
  profileOpen = false,
  onBack,
}: {
  onOpenResult: (row: DiscoveryRow, full: boolean) => Promise<void>;
  detail?: ReactNode;
  profileOpen?: boolean;
  onBack: () => void;
  client: RahClient;
  workspaceId: string;
  mode: "search" | "activity";
}) {
  const [params, setParams] = useSearchParams();
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
        <Shell edge="attached" className="min-h-0 flex-1 border-l-0">
          {mode === "search" ? (
            <SearchFilters params={params} query={query} update={update} />
          ) : (
            <ActivityFilters
              value={filter!}
              onChange={(value) => update("af", value)}
              onRefresh={() => setTick((v) => v + 1)}
            />
          )}
          <Results
            key={`${mode}:${query}:${scope}:${filter}:${tick}:${filterKey}`}
            client={client}
            workspaceId={workspaceId}
            mode={mode}
            query={query}
            searchFilters={searchFilters}
            scope={scope}
            filter={filter}
            tick={tick}
            onOpenResult={onOpenResult}
          />
        </Shell>
      </AppShellMainSlot>
      {detail}
    </>
  );
}
function Results({
  client,
  workspaceId,
  mode,
  query,
  searchFilters,
  scope,
  filter,
  tick,
  onOpenResult,
}: {
  onOpenResult: (row: DiscoveryRow, full: boolean) => Promise<void>;
  client: RahClient;
  workspaceId: string;
  mode: "search" | "activity";
  query: string;
  searchFilters: ReturnType<typeof nativeSearchFilters>;
  scope: WorkspaceSearchRequest["scope"];
  filter: HumanActivityRequest["filter"];
  tick: number;
}) {
  const [route] = useSearchParams();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors.at(-1);
  const [data, setData] = useState<DiscoveryPageResult>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(undefined);
    setError("");
    if (
      mode === "search" &&
      !query.trim() &&
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
        const read =
          mode === "search"
            ? searchPage(
                client,
                {
                  workspaceId,
                  query,
                  scope,
                  ...searchFilters,
                  limit: 20,
                  ...(cursor ? { cursor } : {}),
                },
                controller.signal,
              )
            : activityPage(
                client,
                {
                  workspaceId,
                  filter,
                  limit: 20,
                  ...(cursor ? { cursor } : {}),
                },
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
    cursor,
    retry,
  ]);
  return (
    <SearchShellViewport
      data-testid="discovery-results"
      className="min-h-0 overflow-y-auto"
    >
      {mode === "search" &&
      !query.trim() &&
      !searchFilters.senderKind &&
      !searchFilters.mentionSelf &&
      !searchFilters.after ? (
        <p className="p-4">输入关键词搜索可访问的消息。</p>
      ) : loading ? (
        <Spinner aria-label="正在读取结果" />
      ) : error ? (
        <div role="alert" className="p-4">
          {error}
          <Button onClick={() => setRetry((v) => v + 1)}>重新读取</Button>
        </div>
      ) : (
        data && (
          <>
            <SearchResultsSummary>
              {data.total} 条{mode === "search" ? "匹配消息" : "动态"} · 第{" "}
              {cursors.length} 页
            </SearchResultsSummary>
            <SearchResultsList className="p-3">
              {!data.rows.length ? (
                <p>没有匹配结果</p>
              ) : (
                data.rows.map((row) =>
                  mode === "search" ? (
                    <SearchMessageRow
                      key={row.id}
                      row={row}
                      query={query}
                      selected={route.get("message") === row.message.messageId}
                      onOpen={(full) => {
                        void onOpenResult(row, full).catch(() =>
                          setError("无法打开消息，请刷新重试。"),
                        );
                      }}
                    />
                  ) : (
                    <ActivityMessageRow
                      key={row.id}
                      row={row}
                      active={route.get("message") === row.message.messageId}
                      onOpen={(full) => {
                        void onOpenResult(row, full).catch(() =>
                          setError("无法打开消息，请刷新重试。"),
                        );
                      }}
                    />
                  ),
                )
              )}
            </SearchResultsList>
            <div className="flex gap-2 p-3">
              <Button
                disabled={cursors.length === 1}
                onClick={() => setCursors((value) => value.slice(0, -1))}
              >
                上一页
              </Button>
              <Button
                disabled={!data.nextCursor}
                onClick={() =>
                  setCursors((value) => [...value, data.nextCursor])
                }
              >
                下一页
              </Button>
            </div>
          </>
        )
      )}
    </SearchShellViewport>
  );
}
