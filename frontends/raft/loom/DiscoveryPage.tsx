import { useResizablePanel } from "../packages/web/src/hooks/useResizablePanel.ts";
import { useMediaQuery } from "../packages/web/src/hooks/effectPrimitives.ts";
import { MASTER_DETAIL_COMPACT_PANEL_BOUNDS } from "../packages/web/src/components/layout/masterDetailPanelSizing.ts";
import PanelResizeHandle from "../packages/web/src/components/ui/PanelResizeHandle.tsx";
import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AppShellMainSlot,
  Button,
  Input,
  Spinner,
  SearchShellRoot,
  ActivityInboxPanel,
  SearchShellFilters,
  SearchShellViewport,
  SearchResultsSummary,
  SearchResultsList,
} from "raft-ui";
import { Search, Activity } from "lucide-react";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  WorkspaceSearchRequest,
  HumanActivityRequest,
} from "@rah-os/protocol";
import PanelHeader from "../packages/web/src/components/ui/PanelHeader.tsx";
import { SelectField } from "./ManagementUi.tsx";
import {
  searchPage,
  activityPage,
  type DiscoveryPageResult,
  type DiscoveryRow,
} from "./discovery-client.ts";
import ActivityFilters from "./ActivityFilters.tsx";
import ActivityMessageRow from "./ActivityMessageRow.tsx";
import SearchMessageRow from "./SearchMessageRow.tsx";
import MessageContextDialog from "./MessageContextDialog.tsx";
export default function DiscoveryPage({
  client,
  workspaceId,
  mode,
  onOpenRoom,
  onOpenActivity,
  detail,
}: {
  onOpenActivity: (row: DiscoveryRow, full: boolean) => Promise<void>;
  detail?: ReactNode;
  client: RahClient;
  workspaceId: string;
  mode: "search" | "activity";
  onOpenRoom: (id: string) => Promise<void>;
}) {
  const [params, setParams] = useSearchParams();
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
  const panel = params.has("thread") ? compactPanel : fullPanel;
  useEffect(() => {
    if (detail && !wide)
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.delete("view");
          return next;
        },
        { replace: true },
      );
  }, [!!detail, wide, setParams]);
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
  const [input, setInput] = useState(query);
  useEffect(() => setInput(query), [query]);
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
        className={`relative bg-layer-canvas theme-brutal:bg-white ${detail ? "border-r border-line-muted theme-brutal:border-black" : ""}`}
        style={
          detail
            ? { flex: `0 0 ${panel.width}px`, width: panel.width }
            : undefined
        }
      >
        {detail && (
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
        <PanelHeader
          title={mode === "search" ? "搜索" : "动态"}
          icon={
            mode === "search" ? <Search size={18} /> : <Activity size={18} />
          }
        />
        <Shell edge="attached" className="min-h-0 flex-1 border-l-0">
          {mode === "search" ? (
            <SearchShellFilters className="flex flex-wrap items-end gap-2">
              <>
                <form
                  className="flex min-w-0 flex-1 gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (input.trim() !== query) update("q", input.trim());
                    else setTick((v) => v + 1);
                  }}
                >
                  <Input
                    aria-label="搜索内容"
                    placeholder="搜索消息"
                    maxLength={300}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        (event.nativeEvent.isComposing || event.keyCode === 229)
                      )
                        event.preventDefault();
                    }}
                  />
                  <Button type="submit">搜索消息</Button>
                </form>
                <SelectField
                  label="搜索范围"
                  value={scope!}
                  onChange={(value) => update("scope", value)}
                  options={[
                    { value: "all", label: "全部对话" },
                    { value: "channel", label: "频道" },
                    { value: "direct", label: "私聊" },
                    { value: "thread", label: "线程" },
                  ]}
                />
              </>
            </SearchShellFilters>
          ) : (
            <ActivityFilters
              value={filter!}
              onChange={(value) => update("af", value)}
              onRefresh={() => setTick((v) => v + 1)}
            />
          )}
          <Results
            key={`${mode}:${query}:${scope}:${filter}:${tick}`}
            client={client}
            workspaceId={workspaceId}
            mode={mode}
            query={query}
            scope={scope}
            filter={filter}
            tick={tick}
            onOpenRoom={onOpenRoom}
            onOpenActivity={onOpenActivity}
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
  scope,
  filter,
  tick,
  onOpenRoom,
  onOpenActivity,
}: {
  onOpenActivity: (row: DiscoveryRow, full: boolean) => Promise<void>;
  client: RahClient;
  workspaceId: string;
  mode: "search" | "activity";
  query: string;
  scope: WorkspaceSearchRequest["scope"];
  filter: HumanActivityRequest["filter"];
  tick: number;
  onOpenRoom: (id: string) => Promise<void>;
}) {
  const [route] = useSearchParams();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors.at(-1);
  const [data, setData] = useState<DiscoveryPageResult>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<DiscoveryRow>();
  useEffect(() => {
    const controller = new AbortController();
    setData(undefined);
    setError("");
    if (mode === "search" && !query.trim()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const read =
      mode === "search"
        ? searchPage(
            client,
            {
              workspaceId,
              query,
              scope,
              sort: "recent",
              limit: 20,
              ...(cursor ? { cursor } : {}),
            },
            controller.signal,
          )
        : activityPage(
            client,
            { workspaceId, filter, limit: 20, ...(cursor ? { cursor } : {}) },
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
    return () => controller.abort();
  }, [client, workspaceId, mode, query, scope, filter, tick, cursor, retry]);
  return (
    <SearchShellViewport
      data-testid="discovery-results"
      className="min-h-0 overflow-y-auto"
    >
      {mode === "search" && !query.trim() ? (
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
                      selected={selected?.id === row.id}
                      onOpen={() => setSelected(row)}
                    />
                  ) : (
                    <ActivityMessageRow
                      key={row.id}
                      row={row}
                      active={route.get("message") === row.message.messageId}
                      onOpen={(full) => {
                        void onOpenActivity(row, full).catch(() =>
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
      {selected && (
        <MessageContextDialog
          client={client}
          row={selected}
          onClose={() => setSelected(undefined)}
          onOpenRoom={onOpenRoom}
        />
      )}
    </SearchShellViewport>
  );
}
