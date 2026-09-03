import { useEffect, useMemo, useRef, useState } from "react";
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
  readFrequentSearches,
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
  taskPeopleChoices,
} from "../raft-discovery-controls.ts";
import { DiscoveryFilter } from "./discovery-filter.tsx";
import { GlobalTaskBoard } from "./global-task-board.tsx";
import { Icon } from "./icon.tsx";

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
    <GlobalSearch {...props} people={people} />
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
    preserveCurrentLocation(next);
    setParams(next);
    setCursors([undefined]);
    window.history.replaceState(null, "", `?${next}`);
  }
  function preserveCurrentLocation(next: URLSearchParams) {
    // App owns the current target; filter state may predate opening/closing a Thread.
    const current = new URLSearchParams(window.location.search);
    for (const key of surface === "activity"
      ? ["room", "thread", "message"]
      : ["room"]) {
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
function Empty({
  title,
  detail,
  icon,
}: {
  title: string;
  detail: string;
  icon: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name={icon} />
      </div>
      <h1>{title}</h1>
      <p>{detail}</p>
    </div>
  );
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
    <header className="channel-head activity-head">
      <span className="channel-badge">
        <Icon name={icon} />
      </span>
      <div className="channel-title">
        <h2>{title}</h2>
        <p className="channel-sub">{subtitle}</p>
      </div>
      <div className="head-actions">
        {onRefresh === undefined ? null : (
          <button
            className="sq-btn"
            aria-label={`刷新${title}`}
            onClick={onRefresh}
          >
            <Icon name="refresh-cw" />
          </button>
        )}
        <button
          className="sq-btn rah-mobile-only"
          aria-label="返回聊天"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </header>
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
  const [defaultView] = useState(() =>
    window.matchMedia("(max-width: 767px)").matches ? "list" : "board",
  );
  const view =
    params.get("view") === "list"
      ? "list"
      : params.get("view") === "board"
        ? "board"
        : defaultView;
  const tasks = result.data?.tasks ?? [];
  const columns = createRoomViewModel({
    members: people,
    messages: [],
    tasks: tasks.map((item) => item.task),
  }).taskColumns;
  const options = (filter: "creator" | "assignee") =>
    taskPeopleChoices(people, currentHuman?.principalId, filter).map(
      (person) => ({
        ...person,
        leading:
          person.kind === "none" ? undefined : (
            <Icon name={person.kind === "agent" ? "bot" : "user-round"} />
          ),
      }),
    );
  return (
    <main className="rah-discovery activity-main" aria-label="全局任务">
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
              .map((room) => ({ id: room.roomId, label: room.name }))}
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
                <Icon name={mode === "board" ? "kanban" : "list"} />
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
        <Empty
          icon="task"
          title="没有符合此筛选的任务"
          detail="换一个筛选组合，或清除当前选择。"
        />
      ) : (
        <GlobalTaskBoard
          client={client}
          columns={columns}
          tasks={tasks}
          principalId={currentHuman?.principalId}
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
  const filters = useFilters("search");
  const { params, change } = filters;
  const query = params.get("q") ?? "";
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
  const searchActive = searchShouldRun(query, {
    scopes,
    roomIds: params.getAll("channel"),
    senderIds: params.getAll("sender"),
    timeRange,
    after: afterBound,
    before: beforeBound,
  });
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
  const [frequent, setFrequent] = useState(() =>
    readFrequentSearches(window.localStorage, workspaceId),
  );
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
      setFrequent(readFrequentSearches(window.localStorage, workspaceId));
    }
  }, [filters.cursor, query, result.data, workspaceId]);
  useEffect(() => {
    setHistory(readSearchHistory(window.localStorage, workspaceId));
    setFrequent(readFrequentSearches(window.localStorage, workspaceId));
  }, [workspaceId]);
  const groupedHits = useMemo(() => groupSearchHits(searchHits), [searchHits]);
  const [personError, setPersonError] = useState<string>();
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    box.current?.focus();
  }, []);
  return (
    <main className="rah-discovery search-main" aria-label="全局搜索">
      <header className="search-top">
        <div className="search-title-slot">
          <span className="search-icon-box">
            <Icon name="search" />
          </span>
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
            <span className="search-kbd" aria-hidden="true">
              Esc
            </span>
          </div>
        </div>
      </header>
      <section className="filter-bar" aria-label="搜索筛选">
        <DiscoveryFilter
          label="发送者"
          icon="circle-user-round"
          multiple={false}
          triggerLabel={
            sender
              ? `发送者：${sender.principalId === currentHuman?.principalId ? "我" : sender.handle}`
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
            .map((person) => ({
              id: person.principalId,
              label:
                person.principalId === currentHuman?.principalId
                  ? "我"
                  : person.handle,
              leading: (
                <Icon name={person.kind === "agent" ? "bot" : "user-round"} />
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
        <button className="clear-filters" onClick={filters.clear}>
          清除筛选
        </button>
      </section>
      <Failure error={result.error ?? personError} />
      <section className="search-stage">
        {!searchActive ? (
          <div className="rah-search-home">
            <Empty
              icon="search"
              title="搜索所有内容"
              detail="搜索频道、私信、人类成员、Agent 和消息历史。"
            />
            <SearchSuggestions
              frequent={frequent}
              history={history}
              onClear={() => {
                clearSearchHistory(window.localStorage, workspaceId);
                setHistory([]);
                setFrequent([]);
              }}
              onSelect={(value) => change("q", [value])}
            />
          </div>
        ) : (
          <div className="result-list">
            {result.loading && <p role="status">搜索中…</p>}
            {result.data && (
              <p className="rah-search-count">{result.data.total} 条消息结果</p>
            )}
            {(result.data?.rooms.length || result.data?.principals.length) && (
              <h2 className="rah-search-section-title">服务器内容</h2>
            )}
            {result.data?.rooms.map((room) => (
              <button
                className="rah-search-destination"
                key={room.roomId}
                onClick={() =>
                  onOpen({ target: { kind: "room", roomId: room.roomId } })
                }
              >
                <Icon name={room.kind === "direct" ? "chat" : "hash"} />
                {room.name}
              </button>
            ))}
            {result.data?.principals
              .filter(
                (person) => person.principalId !== currentHuman?.principalId,
              )
              .map((person) => (
                <button
                  className="rah-search-destination"
                  key={person.principalId}
                  onClick={() => {
                    void onPerson(person.principalId).catch((error: unknown) =>
                      setPersonError(
                        error instanceof Error ? error.message : "无法打开私信",
                      ),
                    );
                  }}
                >
                  <Icon name="user-round" />
                  {person.handle} · {person.kind === "agent" ? "Agent" : "成员"}
                </button>
              ))}
            {groupedHits.length > 0 && (
              <h2 className="rah-search-section-title">消息</h2>
            )}
            {groupedHits.map((group) => (
              <SearchResultPanel
                group={group}
                key={group.key}
                onOpen={onOpen}
                query={query}
                rooms={rooms}
              />
            ))}
            {!result.loading &&
              result.data?.total === 0 &&
              !result.data.rooms.length &&
              !result.data.principals.length && (
                <Empty
                  icon="search"
                  title="没有搜索结果"
                  detail="尝试其他关键词或清除筛选。"
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

function SearchSuggestions({
  frequent,
  history,
  onClear,
  onSelect,
}: {
  frequent: readonly string[];
  history: readonly string[];
  onClear: () => void;
  onSelect: (value: string) => void;
}) {
  if (!frequent.length && !history.length) return null;
  return (
    <section className="rah-search-suggestions" aria-label="搜索建议">
      {frequent.length > 0 && (
        <div>
          <h2>常用</h2>
          {frequent.map((value) => (
            <button
              className="rah-search-suggestion rah-interaction-flat"
              key={value}
              onClick={() => onSelect(value)}
            >
              <Icon name="search" /> {value}
            </button>
          ))}
        </div>
      )}
      {history.length > 0 && (
        <div>
          <header>
            <h2>搜索历史</h2>
            <button
              className="rah-search-clear rah-interaction-flat"
              onClick={onClear}
            >
              清除
            </button>
          </header>
          {history.map((value) => (
            <button
              className="rah-search-suggestion rah-interaction-flat"
              key={value}
              onClick={() => onSelect(value)}
            >
              <Icon name="refresh-cw" /> {value}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function SearchResultPanel({
  group,
  onOpen,
  query,
  rooms,
}: {
  group: ReturnType<typeof groupSearchHits>[number];
  onOpen: DiscoveryNavigationHandler;
  query: string;
  rooms: readonly Room[];
}) {
  const first = group.hits[0]!;
  return (
    <article className="rah-search-result-panel" data-kind={group.kind}>
      {group.kind === "thread" && (
        <header>
          <span>消息列</span>
          <b>{first.roomName}</b>
          <span>{group.hits.length} 条匹配</span>
          <time>{new Date(first.message.createdAt).toLocaleString()}</time>
        </header>
      )}
      {group.hits.map((hit) => (
        <button
          className="result-item rah-search-hit"
          key={hit.message.messageId}
          onClick={() => onOpen({ target: hit.target })}
        >
          <span className="result-body">
            <span className="result-channel">
              {rooms.find((room) => room.roomId === hit.message.roomId)
                ?.kind === "direct"
                ? "@"
                : "#"}
              {hit.roomName}
              {hit.rootMessageId && " · 消息列"}
            </span>
            <b className="result-title">{hit.senderName}</b>
            <span className="rah-search-excerpt">
              {highlightParts(
                searchExcerpt(hit.message.body, query),
                query,
              ).map((part, index) =>
                part.match ? <mark key={index}>{part.text}</mark> : part.text,
              )}
            </span>
          </span>
          <time className="result-time">
            {new Date(hit.message.createdAt).toLocaleString()}
          </time>
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
  onOpen,
  onClose,
  navigationEpoch,
  beginNavigation,
}: Props & { people: Principal[] }) {
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
        await client.request(
          "message.context",
          {
            messageId: item.latestMessage.messageId,
          },
          { signal: request.signal },
        );
        if (!request.current()) return;
        await onOpen({ target: item.target, surface: "activity" });
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
          className="tasks-clear"
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
        <div className="feed-wrap">
          {result.loading && !result.data && <p role="status">正在加载动态…</p>}
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
                    {rooms.find((room) => room.roomId === item.roomId)?.kind ===
                    "direct"
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
                    {item.title}
                  </span>
                  <time>
                    {new Date(item.latestMessage.createdAt).toLocaleString()}
                  </time>
                </span>
                <span className="fc-summary">
                  <strong>{item.senderName}:</strong>{" "}
                  {item.latestMessage.body.slice(0, 800)}
                </span>
                <span className="fc-chips">
                  {item.task && (
                    <span
                      className={`activity-chip is-task chip-${taskStatusPresentation(item.task.state).tone}`}
                      data-task-workflow-status={
                        taskStatusPresentation(item.task.state).id
                      }
                    >
                      <Icon
                        name={
                          taskStatusPresentation(item.task.state).id === "done"
                            ? "check"
                            : "eye"
                        }
                      />{" "}
                      #{item.task.taskNumber}
                      {item.task.assigneeId
                        ? ` @${people.find((p) => p.principalId === item.task!.assigneeId)?.handle ?? "Agent"}`
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
                  aria-label={`标记为完成：${item.title.slice(0, 80)}`}
                  title="标记为完成（处理动态，不改变任务状态）"
                  disabled={pending !== undefined}
                  onClick={() => void mark(item, "done")}
                >
                  <Icon name="check" />
                </button>
                {item.threadId && (
                  <button
                    className="rah-unfollow"
                    aria-label={`取消关注：${item.title.slice(0, 80)}`}
                    onClick={() => {
                      void client
                        .request("activity.follow", {
                          roomId: item.roomId,
                          threadId: item.threadId!,
                          following: false,
                        })
                        .then(() => result.refresh())
                        .catch((failure: unknown) => setError(String(failure)));
                    }}
                  >
                    取消关注
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
        {!result.loading && !result.data?.items.length && !result.error && (
          <Empty
            icon="check"
            title="没有待处理动态"
            detail="频道、私信与关注的消息列的新动态会出现在这里。"
          />
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
