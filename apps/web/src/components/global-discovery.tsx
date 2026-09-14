import { useMessageHighlight } from "../use-message-highlight.ts";
import { activityDisplayText } from "../activity-display-names.ts";
import { useResponsiveTaskView } from "../use-responsive-task-view.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { PanelHeader } from "@rah-os/ui-web/neo-brutalist/panel-header";
import { EmptyState } from "@rah-os/ui-web/neo-brutalist/empty-state";
import { PanelHeaderAction } from "@rah-os/ui-web/neo-brutalist/panel-header-action";
import { PanelHeaderIcon } from "@rah-os/ui-web/neo-brutalist/panel-header-icon";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  HumanActivityItem,
  Principal,
  Room,
  WorkspaceSearchResponse,
} from "@rah-os/protocol";
import { createRoomViewModel } from "@rah-os/ui-web";
import {
  type DiscoveryNavigationHandler,
  type GlobalSurface,
  highlightParts,
  groupSearchHits,
  mergeSearchHits,
  searchDateBound,
  searchExcerpt,
} from "../global-discovery-model.ts";
import {
  addSearchHistory,
  clearSearchHistory,
  readSearchHistory,
} from "../search-history.ts";
import { useDiscoveryQuery } from "../use-discovery-query.ts";
import { createLatestRequest } from "../latest-request.ts";
import { taskStatusPresentation } from "../task-presentation.ts";
import {
  normalizeScopes,
  senderKindForScopes,
  reconcileSender,
  searchSort,
  searchShouldRun,
  searchTimeBounds,
  normalizeDiscoveryParams,
} from "../raft-discovery-controls.ts";
import { DiscoveryFilter } from "./discovery-filter.tsx";
import { GlobalTaskBoard } from "./global-task-board.tsx";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { ProfileImageAvatar } from "./profile-image-avatar.tsx";
import { taskPersonOptions } from "./task-person-options.tsx";
import { useWorkspaceEntities } from "./workspace-entity-context.tsx";
import { formatActivityRelativeTime } from "../activity-relative-time.ts";
import { formatRahDateTime } from "../date-time-presentation.ts";
import { SearchResultSkeleton } from "@rah-os/ui-web/neo-brutalist/search-result-skeleton";
import {
  frequentSearchEntities,
  recordSearchOpen,
} from "../search-entity-usage.ts";
import {
  SearchSuggestions,
  SearchDestinationCard,
  type SearchDestination,
} from "./search-cards.tsx";
import { visibleSearchResults } from "../search-visible-results.ts";

type Props = {
  client: RahClient;
  workspaceId: string;
  rooms: readonly Room[];
  currentHuman: Principal | undefined;
  surface: GlobalSurface;
  onOpen: DiscoveryNavigationHandler;
  onPerson: (principalId: string) => Promise<void>;
  onClose: () => void;
  navigationEpoch?: () => number;
  beginNavigation?: () => number;
  taskRefreshVersion?: number;
};

export function GlobalDiscoverySurface(props: Props) {
  const catalog = useDiscoveryQuery(props.client, "search", {
    workspaceId: props.workspaceId,
    query: "",
  });
  const people = catalog.data?.principals ?? [];
  return props.surface === "tasks" ? (
    <GlobalTasks {...props} people={people} />
  ) : props.surface === "search" ? (
    <GlobalSearch
      {...props}
      rooms={catalog.data?.rooms ?? props.rooms}
      people={people}
    />
  ) : (
    <GlobalActivity {...props} people={people} />
  );
}

// URL and request state share one owner; no transcript/localStorage cache.
function useFilters(surface: GlobalSurface) {
  const [params, setParams] = useState(() =>
    normalizeDiscoveryParams(window.location.search, surface),
  );
  useEffect(() => {
    const next = normalizeDiscoveryParams(window.location.search, surface);
    if (window.location.search !== `?${next}`)
      window.history.replaceState(null, "", `?${next}`);
  }, [surface]);
  const [cursors, setCursors] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const cursor = cursors.at(-1);
  useEffect(() => {
    const read = () => {
      setParams(normalizeDiscoveryParams(window.location.search, surface));
      setCursors([undefined]);
    };
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [surface]);
  function changeMany(updates: Record<string, string[]>) {
    const next = new URLSearchParams(params);
    preserveCurrentLocation(next);
    next.set("surface", surface);
    for (const [key, values] of Object.entries(updates)) {
      next.delete(key);
      for (const value of values) next.append(key, value);
    }
    setParams(next);
    setCursors([undefined]);
    window.history.replaceState(null, "", `?${next}`);
  }
  function change(key: string, values: string[]) {
    changeMany({ [key]: values });
  }
  function clear() {
    const next = new URLSearchParams({ surface });
    if (surface === "search" && params.has("q"))
      next.set("q", params.get("q")!);
    if (surface === "search" && params.has("sort"))
      next.set("sort", params.get("sort")!);
    preserveCurrentLocation(next);
    setParams(next);
    setCursors([undefined]);
    window.history.replaceState(null, "", `?${next}`);
  }
  function preserveCurrentLocation(next: URLSearchParams) {
    // App owns the current target; filter state may predate opening/closing a Thread.
    const current = new URLSearchParams(window.location.search);
    for (const key of surface === "activity"
      ? [
          "room",
          "thread",
          "message",
          "previewRoom",
          "previewMessage",
          "previewThread",
          "previewRoot",
          "previewTab",
        ]
      : [
          "room",
          "target",
          "task",
          "highlight",
          "previewRoom",
          "previewMessage",
          "previewThread",
          "previewRoot",
          "previewTab",
        ]) {
      next.delete(key);
      const value = current.get(key);
      if (value) next.set(key, value);
    }
  }
  return {
    params,
    change,
    changeMany,
    clear,
    cursor,
    resetPage: () => setCursors([undefined]),
    previous:
      cursors.length > 1
        ? () => setCursors((items) => items.slice(0, -1))
        : undefined,
    next: (value: string) => setCursors((items) => [...items, value]),
  };
}

function Pager({
  nextCursor,
  loading,
  previous,
  next,
}: {
  nextCursor?: string | undefined;
  loading: boolean;
  previous?: (() => void) | undefined;
  next: (cursor: string) => void;
}) {
  if (!previous && !nextCursor) return null;
  return (
    <nav className="rah-discovery-pager" aria-label="查询分页">
      <button
        className="btn"
        disabled={loading || !previous}
        onClick={previous}
      >
        上一页
      </button>
      <button
        className="btn"
        disabled={loading || !nextCursor}
        onClick={() => nextCursor && next(nextCursor)}
      >
        下一页
      </button>
    </nav>
  );
}
function Failure({ error }: { error?: string | undefined }) {
  return error ? (
    <p role="alert" className="rah-inline-error">
      {error}
    </p>
  ) : null;
}
function Header({
  title,
  subtitle,
  icon,
  onRefresh,
  onClose,
}: {
  title: string;
  subtitle: string;
  icon: string;
  onRefresh?: (() => void) | undefined;
  onClose: () => void;
}) {
  return (
    <PanelHeader kind="surface" className="activity-head">
      <PanelHeaderIcon name={icon} />
      <div className="channel-title">
        <h2 className="rah-panel-title">{title}</h2>
        <p className="channel-sub">{subtitle}</p>
      </div>
      <div className="head-actions">
        {onRefresh === undefined ? null : (
          <PanelHeaderAction aria-label={`刷新${title}`} onClick={onRefresh}>
            <Icon name="refresh-cw" />
          </PanelHeaderAction>
        )}
        <PanelHeaderAction
          className="rah-mobile-only"
          aria-label="返回聊天"
          onClick={onClose}
        >
          <Icon name="x" />
        </PanelHeaderAction>
      </div>
    </PanelHeader>
  );
}

function GlobalTasks({
  client,
  workspaceId,
  rooms,
  people,
  currentHuman,
  onOpen,
  onClose,
  taskRefreshVersion,
}: Props & { people: Principal[] }) {
  const filters = useFilters("tasks");
  const { params, change } = filters;
  const result = useDiscoveryQuery(client, "task.global.list", {
    workspaceId,
    roomIds: params.getAll("channel"),
    creatorIds: params.getAll("creator"),
    assigneeIds: params.getAll("assignee").filter((id) => id !== "unassigned"),
    unassigned: params.getAll("assignee").includes("unassigned"),
    ...(filters.cursor ? { cursor: filters.cursor } : {}),
    limit: 100,
  });
  useEffect(() => {
    result.refresh();
  }, [taskRefreshVersion, result.refresh]);
  const selectedView = params.get("view");
  const { ref: taskPaneRef, view } = useResponsiveTaskView(
    selectedView === "board" || selectedView === "list"
      ? selectedView
      : undefined,
  );
  const tasks = result.data?.tasks ?? [];
  const columns = createRoomViewModel({
    members: people,
    messages: [],
    tasks: tasks.map((item) => item.task),
  }).taskColumns;
  const entities = useWorkspaceEntities();
  const filtersActive =
    params.has("channel") || params.has("creator") || params.has("assignee");
  const options = (filter: "creator" | "assignee") =>
    taskPersonOptions(people, currentHuman?.principalId, filter, entities);
  return (
    <main
      className="rah-discovery activity-main"
      aria-label="全局任务"
      ref={taskPaneRef}
    >
      <Header
        title="任务"
        subtitle={`${result.data?.total ?? 0} 个频道任务${result.data?.nextCursor || filters.previous ? ` · 本页 ${tasks.length} 项` : ""}`}
        icon="task"
        onClose={onClose}
      />
      <section className="tasks-toolbar">
        <div className="tasks-toolbar-row">
          <DiscoveryFilter
            label="频道"
            icon="hash"
            options={rooms
              .filter(
                (room) =>
                  room.workspaceId === workspaceId && room.kind === "channel",
              )
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((room) => ({ id: room.roomId, label: `#${room.name}` }))}
            values={params.getAll("channel")}
            onChange={(values) => change("channel", values)}
          />
          <DiscoveryFilter
            label="创建者"
            icon="circle-user-round"
            options={options("creator")}
            values={params.getAll("creator")}
            onChange={(values) => change("creator", values)}
          />
          <DiscoveryFilter
            label="负责人"
            options={options("assignee")}
            values={params.getAll("assignee")}
            onChange={(values) => change("assignee", values)}
          />
          {(params.has("channel") ||
            params.has("creator") ||
            params.has("assignee")) && (
            <button className="tasks-clear" onClick={filters.clear}>
              清除筛选
            </button>
          )}
          <div className="tasks-view" role="radiogroup" aria-label="任务视图">
            {(["board", "list"] as const).map((mode) => (
              <button
                className="rah-interaction-segment"
                key={mode}
                role="radio"
                aria-checked={view === mode}
                onClick={() => change("view", [mode])}
              >
                <Icon name={mode === "board" ? "columns-3" : "layout-list"} />
                {mode === "board" ? "看板" : "列表"}
              </button>
            ))}
          </div>
        </div>
      </section>
      <Failure error={result.error} />
      {result.loading && !result.data ? (
        <p role="status">正在加载任务…</p>
      ) : !tasks.length ? (
        <EmptyState
          context="task"
          placement="fill"
          icon="task"
          title={filtersActive ? "没有符合此筛选的任务" : "暂无任务"}
          description={
            filtersActive
              ? "换一个筛选组合，或清除当前选择。"
              : "此工作区还没有频道任务。"
          }
        />
      ) : (
        <GlobalTaskBoard
          openSurface="tasks"
          client={client}
          columns={columns}
          tasks={tasks}
          view={view as "board" | "list"}
          onOpen={onOpen}
          onChanged={result.refresh}
        />
      )}
      <Pager
        nextCursor={result.data?.nextCursor}
        loading={result.loading}
        previous={filters.previous}
        next={filters.next}
      />
    </main>
  );
}

function GlobalSearch({
  client,
  workspaceId,
  rooms,
  people,
  currentHuman,
  onOpen,
  onPerson,
  onClose,
}: Props & { people: Principal[] }) {
  const entities = useWorkspaceEntities();
  const filters = useFilters("search");
  const { params, change } = filters;
  const query = params.get("q") ?? "";
  const highlight = useMessageHighlight(query ? params.toString() : undefined);
  const scopes = normalizeScopes(params.getAll("scope"));
  const senderKind = senderKindForScopes(scopes);
  const sender = people.find(
    (person) => person.principalId === params.get("sender"),
  );
  const timeRange = params.get("time") ?? "any";
  // A page chain shares fixed time bounds, so its signed cursor never drifts with the clock.
  const rangeBounds = useMemo(() => searchTimeBounds(timeRange), [timeRange]);
  const date = params.get("after");
  const before = params.get("before");
  const afterBound = rangeBounds.after ?? searchDateBound(date);
  const beforeBound = rangeBounds.before ?? searchDateBound(before, true);
  const [composing, setComposing] = useState(false);
  const searchFilters = {
    scopes,
    roomIds: params.getAll("channel"),
    senderIds: params.getAll("sender"),
    timeRange,
    after: afterBound,
    before: beforeBound,
  };
  const searchActive = searchShouldRun(query, searchFilters);
  const filtersActive = searchShouldRun("", searchFilters);
  const result = useDiscoveryQuery(
    client,
    "search",
    {
      workspaceId,
      query,
      ...(senderKind ? { senderKind } : {}),
      mentionSelf: scopes.includes("mentioned"),
      roomIds: params.getAll("channel"),
      senderIds: params.getAll("sender"),
      sort: searchSort(query, params.get("sort")),
      ...(afterBound ? { after: afterBound } : {}),
      ...(beforeBound ? { before: beforeBound } : {}),
      ...(filters.cursor ? { cursor: filters.cursor } : {}),
    },
    !composing && searchActive,
  );
  const searchScope = JSON.stringify({
    workspaceId,
    query,
    scopes,
    senderKind,
    roomIds: params.getAll("channel"),
    senderIds: params.getAll("sender"),
    sort: searchSort(query, params.get("sort")),
    afterBound,
    beforeBound,
  });
  const [searchHits, setSearchHits] = useState<WorkspaceSearchResponse["hits"]>(
    [],
  );
  const [history, setHistory] = useState(() =>
    readSearchHistory(window.localStorage, workspaceId),
  );
  const destinations: SearchDestination[] = [
    ...rooms.map((room): SearchDestination => {
      const rawPeer = people.find(
        (person) =>
          room.directParticipantIds?.includes(person.principalId) &&
          person.principalId !== currentHuman?.principalId,
      );
      const peer = rawPeer
        ? (entities?.resolvePerson(rawPeer) ?? rawPeer)
        : undefined;
      return {
        key: `room:${room.roomId}`,
        privateChannel: room.visibility === "private",
        title: peer?.displayName || peer?.handle || room.name,
        subtitle: peer
          ? `@${peer.kind === "human" ? peer.displayName || peer.handle : peer.handle}`
          : room.description || "频道",
        badge: peer ? (peer.kind === "agent" ? "Agent" : "人类成员") : "频道",
        roomId: room.roomId,
        kind: peer ? (peer.kind === "agent" ? "agent" : "human") : "channel",
        ...(peer?.avatarKey ? { avatarKey: peer.avatarKey } : {}),
        ...(peer ? { principalId: peer.principalId } : {}),
      };
    }),
    ...people
      .filter((person) => person.principalId !== currentHuman?.principalId)
      .map((person) => entities?.resolvePerson(person) ?? person)
      .map((person) => ({
        key: `person:${person.principalId}`,
        title: person.displayName || person.handle,
        subtitle: `@${person.kind === "human" ? person.displayName || person.handle : person.handle}`,
        badge: person.kind === "agent" ? "Agent" : "人类成员",
        principalId: person.principalId,
        kind: person.kind === "agent" ? ("agent" as const) : ("human" as const),
        ...(person.avatarKey ? { avatarKey: person.avatarKey } : {}),
      })),
  ];
  const usageScope = `${workspaceId}:${currentHuman?.principalId ?? "local"}`;
  const frequent = frequentSearchEntities(
    window.localStorage,
    usageScope,
    destinations.filter(
      (entry) =>
        !entry.roomId ||
        !rooms.find((room) => room.roomId === entry.roomId)?.archivedAt,
    ),
  );
  const openDestination = (entry: SearchDestination) => {
    recordSearchOpen(window.localStorage, usageScope, entry.key);
    if (entry.roomId)
      onOpen({ target: { kind: "room", roomId: entry.roomId } });
    else if (entry.principalId)
      void onPerson(entry.principalId).catch((error: unknown) =>
        setPersonError(error instanceof Error ? error.message : "无法打开私信"),
      );
  };
  useEffect(() => setSearchHits([]), [searchScope]);
  useEffect(() => {
    if (!result.data) return;
    setSearchHits((current) =>
      filters.cursor
        ? mergeSearchHits(current, result.data!.hits)
        : result.data!.hits,
    );
    if (query.trim() && !filters.cursor) {
      setHistory(addSearchHistory(window.localStorage, workspaceId, query));
    }
  }, [filters.cursor, query, result.data, workspaceId]);
  useEffect(() => {
    setHistory(readSearchHistory(window.localStorage, workspaceId));
  }, [workspaceId]);
  const groupedHits = useMemo(() => groupSearchHits(searchHits), [searchHits]);
  const visibleResults = visibleSearchResults(
    result.data,
    searchHits,
    currentHuman?.principalId,
  );
  const [personError, setPersonError] = useState<string>();
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    box.current?.focus();
  }, []);
  return (
    <main className="rah-discovery search-main" aria-label="全局搜索">
      <PanelHeader kind="surface" className="search-top">
        <PanelHeaderAction
          aria-label="返回聊天"
          className="rah-mobile-only"
          onClick={onClose}
        >
          <Icon name="arrow-left" />
        </PanelHeaderAction>
        <div className="search-title-slot">
          <PanelHeaderIcon name="search" />
          <div className="search-box">
            <input
              ref={box}
              aria-label="搜索频道、私信、消息"
              placeholder="搜索频道、私信、消息…   ⌘K"
              value={query}
              onChange={(event) => change("q", [event.target.value])}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Escape") {
                  event.preventDefault();
                  if (query) change("q", []);
                  else onClose();
                }
              }}
            />
            {query && (
              <PanelHeaderAction
                aria-label="清除搜索"
                size="compact"
                onClick={() => {
                  change("q", []);
                  box.current?.focus();
                }}
              >
                <Icon name="x" />
              </PanelHeaderAction>
            )}
            <span className="search-kbd" aria-hidden="true">
              Esc
            </span>
          </div>
        </div>
      </PanelHeader>
      <section className="filter-bar" aria-label="搜索筛选">
        <DiscoveryFilter
          label="发送者"
          icon="circle-user-round"
          multiple={false}
          triggerLabel={
            sender
              ? `发送者：${sender.principalId === currentHuman?.principalId ? "我" : entities?.resolvePerson(sender).displayName || sender.displayName || sender.handle}`
              : "发送者"
          }
          options={[...people]
            .sort((a, b) =>
              a.principalId === currentHuman?.principalId
                ? -1
                : b.principalId === currentHuman?.principalId
                  ? 1
                  : a.handle.localeCompare(b.handle),
            )
            .map((person) => entities?.resolvePerson(person) ?? person)
            .map((person) => ({
              id: person.principalId,
              label:
                person.principalId === currentHuman?.principalId
                  ? "我"
                  : person.displayName || person.handle,
              leading: (
                <ProfileImageAvatar
                  avatarKey={person.avatarKey}
                  name={person.displayName ?? person.handle}
                  kind={person.kind}
                  principalId={person.principalId}
                  size="compact"
                />
              ),
            }))}
          values={params.getAll("sender")}
          onChange={(values) => {
            const next = people.find(
              (person) => person.principalId === values[0],
            );
            const mismatch = next && senderKind && senderKind !== next.kind;
            filters.changeMany({
              sender: values,
              scope: mismatch
                ? scopes.filter((scope) => scope === "mentioned")
                : scopes,
            });
          }}
        />
        <DiscoveryFilter
          label="范围"
          icon="at-sign"
          searchable={false}
          options={[
            { id: "mentioned", label: "@我" },
            { id: "humans", label: "人类" },
            { id: "agents", label: "Agent" },
          ]}
          values={scopes}
          onChange={(values) => {
            const next = normalizeScopes(values),
              id = reconcileSender(next, sender);
            filters.changeMany({ scope: next, sender: id ? [id] : [] });
          }}
        />
        {params.has("channel") ? (
          <button
            className="rah-search-channel-chip"
            aria-label="清除频道筛选"
            onClick={() => change("channel", [])}
          >
            <Icon name="hash" />#
            {rooms.find((room) => room.roomId === params.get("channel"))
              ?.name ?? "频道"}
            <Icon name="x" />
          </button>
        ) : (
          <DiscoveryFilter
            label="频道"
            multiple={false}
            icon="hash"
            options={rooms
              .filter(
                (room) =>
                  room.workspaceId === workspaceId && room.kind === "channel",
              )
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((room) => ({
                id: room.roomId,
                label: `${room.kind === "direct" ? "@" : "#"}${room.name}`,
              }))}
            values={params.getAll("channel")}
            onChange={(values) => change("channel", values)}
          />
        )}
        <DiscoveryFilter
          label="时间"
          icon="calendar-range"
          multiple={false}
          searchable={false}
          clearable={false}
          triggerLabel={
            (
              {
                any: "不限时间",
                today: "今天",
                "7d": "最近7天",
                "30d": "最近30天",
              } as Record<string, string>
            )[timeRange] ?? "不限时间"
          }
          selected={timeRange !== "any"}
          values={[timeRange]}
          options={[
            { id: "any", label: "不限时间" },
            { id: "today", label: "今天" },
            { id: "7d", label: "最近7天" },
            { id: "30d", label: "最近30天" },
          ]}
          onChange={(values) =>
            filters.changeMany({ time: values, after: [], before: [] })
          }
        />
        <DiscoveryFilter
          label="排序"
          icon="arrow-up-down"
          multiple={false}
          searchable={false}
          clearable={false}
          triggerLabel={params.get("sort") === "recent" ? "最新" : "相关度"}
          disabled={!query.trim()}
          selected={false}
          values={[params.get("sort") === "recent" ? "recent" : "relevance"]}
          options={[
            { id: "relevance", label: "相关度" },
            { id: "recent", label: "最新" },
          ]}
          onChange={(values) => change("sort", values)}
        />
        {filtersActive && (
          <button className="clear-filters" onClick={filters.clear}>
            清除筛选
          </button>
        )}
      </section>
      <Failure error={personError} />
      <section className="search-stage">
        {!searchActive ? (
          history.length > 0 || frequent.length > 0 ? (
            <SearchSuggestions
              frequent={frequent}
              history={history}
              onClear={() => {
                clearSearchHistory(window.localStorage, workspaceId);
                setHistory([]);
              }}
              onSelect={(value) => change("q", [value])}
              onOpen={openDestination}
              onRemove={(value) => {
                const next = history.filter(
                  (item) =>
                    item.toLocaleLowerCase() !== value.toLocaleLowerCase(),
                );
                clearSearchHistory(window.localStorage, workspaceId);
                for (const item of [...next].reverse())
                  addSearchHistory(window.localStorage, workspaceId, item);
                setHistory(next);
              }}
            />
          ) : (
            <EmptyState
              context="search"
              placement="fill"
              icon="search"
              title="搜索所有内容"
              description="搜索频道、私信、人类成员、Agent 和消息历史。"
            />
          )
        ) : (
          <div className="result-list">
            {result.loading && !result.data ? (
              <SearchResultSkeleton />
            ) : result.error && !result.data ? (
              <section className="rah-search-failure" role="alert">
                <b>搜索失败</b>
                <p>无法加载搜索结果。请检查连接后重试。</p>
                <button className="btn" onClick={result.refresh} type="button">
                  重试
                </button>
              </section>
            ) : null}
            {result.data && (
              <p className="rah-search-count">{visibleResults.count} 条结果</p>
            )}
            {Boolean(
              result.data?.rooms.length || visibleResults.principals.length,
            ) && <h2 className="rah-search-section-title">服务器内容</h2>}
            {destinations
              .filter((entry) =>
                entry.roomId
                  ? result.data?.rooms.some(
                      (room) => room.roomId === entry.roomId,
                    )
                  : visibleResults.principals.some(
                      (person) => person.principalId === entry.principalId,
                    ),
              )
              .map((entry) => (
                <SearchDestinationCard
                  key={entry.key}
                  entry={entry}
                  onOpen={openDestination}
                />
              ))}
            {groupedHits.length > 0 && (
              <h2 className="rah-search-section-title">消息</h2>
            )}
            {groupedHits.map((group) => (
              <SearchResultPanel
                group={group}
                highlight={highlight.visible}
                key={group.key}
                onOpen={onOpen}
                query={query}
                rooms={rooms}
              />
            ))}
            {!result.loading &&
              !result.error &&
              result.data &&
              visibleResults.count === 0 && (
                <EmptyState
                  context="search"
                  placement="section"
                  icon="search"
                  title={
                    query.trim()
                      ? `没有找到“${query.trim()}”的结果`
                      : "没有匹配的消息"
                  }
                  description={
                    query.trim()
                      ? "试试其他关键词或更短的短语。"
                      : "试试其他筛选组合。"
                  }
                />
              )}
            {result.data?.nextCursor && (
              <button
                className="btn rah-search-load-more"
                disabled={result.loading}
                onClick={() => filters.next(result.data!.nextCursor!)}
              >
                {result.loading ? "正在加载…" : "加载更多"}
              </button>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function SearchResultPanel({
  group,
  highlight,
  onOpen,
  query,
  rooms,
}: {
  group: ReturnType<typeof groupSearchHits>[number];
  highlight: boolean;
  onOpen: DiscoveryNavigationHandler;
  query: string;
  rooms: readonly Room[];
}) {
  const [hovered, setHovered] = useState<string>();
  const first = group.hits[0]!;
  const entities = useWorkspaceEntities();
  return (
    <article className="rah-search-result-panel" data-kind={group.kind}>
      {group.kind === "thread" && (
        <header>
          <span>消息列</span>
          <b>#{first.roomName}</b>
          <span>{group.hits.length} 条匹配</span>
          <time>
            {formatActivityRelativeTime(
              group.hits
                .map((hit) => hit.message.createdAt)
                .sort()
                .at(-1)!,
            )}
          </time>
          <strong className="rah-search-thread-title">
            {first.rootMessagePreview || "消息列讨论"}
          </strong>
        </header>
      )}
      {group.hits.map((hit) => (
        <button
          className="result-item rah-search-hit"
          key={hit.message.messageId}
          onMouseEnter={() => setHovered(hit.message.messageId)}
          onMouseLeave={() => setHovered(undefined)}
          onClick={() => {
            setHovered(undefined);
            return onOpen({ target: hit.target, highlightQuery: query });
          }}
        >
          <span className="result-body">
            <span className="rah-search-hit-meta">
              <span className="result-channel">
                {rooms.find((room) => room.roomId === hit.message.roomId)
                  ?.kind === "direct"
                  ? "@"
                  : "#"}
                {hit.roomName}
                {hit.rootMessageId && " · 消息列"}
              </span>
              <span className="rah-search-hit-author">
                <ProfileImageAvatar
                  name={
                    entities?.person(hit.message.actorId)?.displayName ||
                    hit.senderName
                  }
                  avatarKey={entities?.person(hit.message.actorId)?.avatarKey}
                  kind={entities?.person(hit.message.actorId)?.kind ?? "human"}
                  size="compact"
                />
                <b className="result-title">
                  {entities?.person(hit.message.actorId)?.displayName ||
                    hit.senderName}
                </b>
              </span>
              <time className="result-time">
                {formatActivityRelativeTime(hit.message.createdAt)}
              </time>
            </span>
            <span className="rah-search-excerpt">
              {highlightParts(
                searchExcerpt(
                  activityDisplayText(
                    hit.message.body,
                    entities?.humans().map((member) => member.principal) ?? [],
                  ),
                  query,
                ),
                query,
              ).map((part, index) =>
                part.match &&
                (highlight || hovered === hit.message.messageId) ? (
                  <mark key={index}>{part.text}</mark>
                ) : (
                  part.text
                ),
              )}
            </span>
          </span>
        </button>
      ))}
    </article>
  );
}

function GlobalActivity({
  client,
  workspaceId,
  rooms,
  people,
  currentHuman,
  onOpen,
  onClose,
  navigationEpoch,
  beginNavigation,
}: Props & { people: Principal[] }) {
  const entities = useWorkspaceEntities();
  const humans = [
    ...new Map(
      [...people, ...(currentHuman ? [currentHuman] : [])]
        .filter((person) => person.kind === "human")
        .map(
          (person) =>
            [
              person.principalId,
              entities?.resolvePerson(person) ?? person,
            ] as const,
        ),
    ).values(),
  ];
  const displayText = (source: string) => activityDisplayText(source, humans);
  const actionGate = useRef(createLatestRequest());
  useEffect(() => () => actionGate.current.cancel(), [client, workspaceId]);
  const filters = useFilters("activity");
  const filter =
    filters.params.get("filter") === "unread"
      ? "unread"
      : filters.params.get("filter") === "mentions"
        ? "mentions"
        : "all";
  const result = useDiscoveryQuery(client, "activity.list", {
    workspaceId,
    filter,
    ...(filters.cursor ? { cursor: filters.cursor } : {}),
  });
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const actionScope = filters.params.toString() + ":" + (filters.cursor ?? "");
  useEffect(() => {
    actionGate.current.cancel();
    setPending(undefined);
    setError(undefined);
  }, [actionScope, client, workspaceId]);
  async function mark(
    item: HumanActivityItem,
    action: "done" | "read",
    open = false,
  ) {
    const epoch = open
      ? (beginNavigation?.() ?? navigationEpoch?.())
      : navigationEpoch?.();
    const href = window.location.href;
    const request = actionGate.current.begin(
      () => navigationEpoch?.() === epoch && window.location.href === href,
    );
    setPending(item.key);
    try {
      // Do not clear unread if the exact target is unavailable (e.g. membership revoked).
      if (open) {
        const context = await client.request(
          "message.context",
          {
            messageId: item.latestMessage.messageId,
          },
          { signal: request.signal },
        );
        if (!request.current()) return;
        await onOpen({
          target: {
            kind: "message",
            roomId: context.message.roomId,
            messageId: context.message.messageId,
            ...(context.message.threadId === undefined
              ? {}
              : { threadId: context.message.threadId }),
            ...(context.rootMessageId === undefined
              ? {}
              : { rootMessageId: context.rootMessageId }),
          },
          surface: "activity",
        });
        // The mounted conversation acknowledges the messages actually in its viewport.
        return;
      }
      await client.request("activity.mark", {
        action,
        roomId: item.roomId,
        ...(item.threadId ? { threadId: item.threadId } : {}),
        throughSeq: item.latestSeq,
      });
      if (request.current()) {
        setError(undefined);
        result.refresh();
      }
    } catch (failure) {
      if (request.current())
        setError(failure instanceof Error ? failure.message : "处理失败");
    } finally {
      if (request.owns()) setPending(undefined);
    }
  }
  async function readVisible() {
    const epoch = navigationEpoch?.();
    const href = window.location.href;
    const request = actionGate.current.begin(
      () => navigationEpoch?.() === epoch && window.location.href === href,
    );
    setPending("all");
    try {
      // Only acknowledge observed frontiers, never unseen/new arrivals or another page.
      for (const item of result.data?.items ?? []) {
        if (!request.current()) return;
        await client.request("activity.mark", {
          action: "read",
          roomId: item.roomId,
          ...(item.threadId ? { threadId: item.threadId } : {}),
          throughSeq: item.latestSeq,
        });
      }
      if (request.current()) {
        setError(undefined);
        result.refresh();
      }
    } catch (failure) {
      if (request.current())
        setError(failure instanceof Error ? failure.message : "处理失败");
    } finally {
      if (request.owns()) setPending(undefined);
    }
  }
  return (
    <main className="rah-discovery activity-main" aria-label="全局动态">
      <Header
        title="动态"
        subtitle={`${result.data?.total ?? 0} 条进行中`}
        icon="pulse"
        onRefresh={() => {
          filters.resetPage();
          result.refresh();
        }}
        onClose={onClose}
      />
      <section className="activity-toolbar">
        <div
          className="activity-filters"
          role="radiogroup"
          aria-label="筛选收件箱"
        >
          {(
            [
              ["all", "全部"],
              ["unread", "未读"],
              ["mentions", "提及"],
            ] as const
          ).map(([id, label]) => (
            <button
              className="activity-filter"
              key={id}
              role="radio"
              aria-checked={filter === id}
              onClick={() => filters.change("filter", [id])}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="btn rah-activity-read-all"
          disabled={
            pending !== undefined ||
            result.loading ||
            !result.data?.items.length
          }
          onClick={() => void readVisible()}
        >
          {result.data?.nextCursor || filters.previous
            ? "本页已读"
            : "全部已读"}
        </button>
      </section>
      <Failure error={error ?? result.error} />
      <section className="feed">
        {!result.loading && !result.data?.items.length && !result.error ? (
          <EmptyState
            context="activity"
            placement="fill"
            icon="check"
            title="没有待处理动态"
            description="频道、私信与关注的消息列的新动态会出现在这里。"
          />
        ) : (
          <div className="feed-wrap">
            {result.loading && !result.data && (
              <p role="status">正在加载动态…</p>
            )}
            {result.data?.items.map((item) => (
              <article
                key={item.key}
                className="feed-card"
                data-unread={item.unreadCount > 0}
              >
                <button
                  className="fc-content rah-activity-open"
                  onClick={() => void mark(item, "read", true)}
                  disabled={pending !== undefined}
                >
                  {item.threadId && (
                    <span className="fc-channel">
                      {rooms.find((room) => room.roomId === item.roomId)
                        ?.kind === "direct"
                        ? "@"
                        : "#"}
                      {item.roomName}
                    </span>
                  )}
                  <span className="fc-heading-row">
                    <span className="fc-title">
                      <Icon
                        name={
                          item.threadId
                            ? "chat"
                            : item.kind === "direct"
                              ? "at-sign"
                              : "hash"
                        }
                      />
                      {displayText(item.title)}
                    </span>
                    <time>
                      {formatActivityRelativeTime(
                        item.latestMessage.createdAt,
                      ) ?? "时间未知"}
                    </time>
                  </span>
                  <span className="fc-summary">
                    <strong>
                      {humans.find(
                        (person) =>
                          person.principalId === item.latestMessage.actorId,
                      )?.displayName || item.senderName}
                      :
                    </strong>{" "}
                    {displayText(item.latestMessage.body).slice(0, 800)}
                  </span>
                  <span className="fc-chips">
                    {item.task && (
                      <span
                        className={`activity-chip is-task chip-${taskStatusPresentation(item.task).tone}`}
                        data-task-status={taskStatusPresentation(item.task).id}
                        data-task-workflow-status={
                          taskStatusPresentation(item.task).id
                        }
                      >
                        <Icon
                          name={
                            taskStatusPresentation(item.task).id === "done"
                              ? "check"
                              : "eye"
                          }
                        />{" "}
                        #{item.task.taskNumber}
                        {item.task.assigneeId
                          ? ` @${entities?.person(item.task!.assigneeId)?.displayName || people.find((p) => p.principalId === item.task!.assigneeId)?.displayName || "成员"}`
                          : ""}
                      </span>
                    )}
                    {item.replyCount > 0 && (
                      <span className="activity-chip">
                        {item.replyCount} 条回复
                      </span>
                    )}
                    {item.unreadCount > 0 && (
                      <span className="activity-chip rah-new-message-count">
                        {item.unreadCount} 条新消息
                      </span>
                    )}
                  </span>
                </button>
                <div className="fc-actions">
                  <button
                    className="activity-done"
                    aria-label={`标记为完成：${displayText(item.title).slice(0, 80)}`}
                    title="标记为完成（处理动态，不改变任务状态）"
                    disabled={pending !== undefined}
                    onClick={() => void mark(item, "done")}
                  >
                    <Icon name="check" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <Pager
        nextCursor={result.data?.nextCursor}
        loading={result.loading}
        previous={filters.previous}
        next={filters.next}
      />
    </main>
  );
}

function formatDiscoveryDateTime(value: string): string {
  return formatRahDateTime(value, {
    dateStyle: "short",
    timeStyle: "short",
  });
}
