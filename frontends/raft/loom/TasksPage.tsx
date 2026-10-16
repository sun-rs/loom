import {
  TaskBoardProvider,
  TaskBoardRouteOwner,
  TaskBoardNotice,
  useTaskBoard,
} from "./TaskBoardActions.tsx";
import TaskCreate from "./TaskCreate.tsx";
import type { ChannelTaskClient } from "./channel-task-client.ts";
import { useIntl } from "react-intl";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  TasksPanelRoot,
  TasksPanelToolbar,
  TasksPanelViewport,
  Button,
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlLabel,
} from "raft-ui";
import {
  CheckSquare,
  Columns3,
  LayoutList,
  Hash,
  ChevronDown,
  Plus,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  GlobalTasksResponse,
  Room,
  TaskWorkflowStatus,
} from "@rah-os/protocol";
import {
  // @ts-expect-error -- checked build adapter exports this unchanged native function.
  TaskSection,
  // @ts-expect-error -- checked build adapter exports this unchanged native function.
  DroppableColumn,
} from "../packages/web/src/components/task/TasksPanel.tsx";
import { TaskVirtualLayout } from "../packages/web/src/components/task/VirtualizedTaskStack.tsx";
import { SkeletonRow } from "../packages/web/src/components/ui/Skeleton.tsx";
import EmptyState from "../packages/web/src/components/ui/EmptyState.tsx";
import SelectionPopover from "../packages/web/src/components/ui/SelectionPopover.tsx";
import { useMediaQuery } from "../packages/web/src/hooks/effectPrimitives.ts";
import type { Task } from "../packages/web/src/store/taskStore.ts";
import { toOfficialTask } from "./task-client.ts";
import { useIntentRoute, hasRouteBoundIntent } from "./useIntentRoute.ts";
import TaskDetail from "./TaskDetail.tsx";
const statuses: TaskWorkflowStatus[] = [
  "todo",
  "in_progress",
  "in_review",
  "done",
  "closed",
];
export default function TasksPage({
  client,
  workspaceId,
  rooms,
  channelTasks,
}: {
  channelTasks?: ChannelTaskClient;
  client: RahClient;
  workspaceId: string;
  rooms: Room[];
}) {
  const { formatMessage } = useIntl();
  const [creating, setCreating] = useState(false);
  const [params, setParams] = useIntentRoute();
  const mobile = useMediaQuery("(max-width: 767.98px)");
  const mode =
    params.get("taskView") === "board"
      ? "board"
      : params.get("taskView") === "list"
        ? "list"
        : mobile
          ? "list"
          : "board";
  const roomId = channelTasks?.channel.roomId ?? params.get("taskRoom") ?? "";
  const [rows, setRows] = useState<GlobalTasksResponse["tasks"]>([]),
    [next, setNext] = useState<string>(),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0),
    [loadingMore, setLoadingMore] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    done: true,
    closed: true,
  });
  const [filter, setFilter] = useState(false),
    [search, setSearch] = useState("");
  const filterHost = useRef<HTMLDivElement>(null),
    scroll = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const update = (name: string, value: string) => {
    if (hasRouteBoundIntent()) return;
    setParams((previous) => {
      const p = new URLSearchParams(previous);
      if (value) p.set(name, value);
      else p.delete(name);
      return p;
    });
  };
  useEffect(() => {
    if (!filter) return;
    const click = (e: PointerEvent) => {
      if (!filterHost.current?.contains(e.target as Node)) setFilter(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFilter(false);
        filterHost.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", click);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", click);
      document.removeEventListener("keydown", key);
    };
  }, [filter]);
  useEffect(() => {
    const id = ++generation.current,
      abort = new AbortController();
    setRows([]);
    setNext(undefined);
    setLoading(true);
    setLoadingMore(false);
    setError("");
    void client
      .request(
        "task.global.list",
        { workspaceId, limit: 50, ...(roomId ? { roomIds: [roomId] } : {}) },
        { signal: abort.signal },
      )
      .then((result) => {
        if (id !== generation.current || abort.signal.aborted) return;
        setRows(result.tasks);
        setNext(result.nextCursor);
        setTotal(result.total);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError("任务列表读取失败，请重试。");
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => {
      abort.abort();
      generation.current++;
    };
  }, [client, workspaceId, roomId, tick]);
  const more = async () => {
    if (!next || loadingMore || rows.length >= 500) return;
    const id = generation.current;
    setLoadingMore(true);
    try {
      const result = await client.request("task.global.list", {
        workspaceId,
        cursor: next,
        limit: 50,
        ...(roomId ? { roomIds: [roomId] } : {}),
      });
      if (id !== generation.current) return;
      setRows((old) => [
        ...old,
        ...result.tasks.filter(
          (t) => !old.some((o) => o.task.taskId === t.task.taskId),
        ),
      ]);
      setNext(result.nextCursor);
      setTotal(result.total);
      setError("");
    } catch {
      if (id === generation.current) setError("更多任务读取失败，请重试。");
    } finally {
      if (id === generation.current) setLoadingMore(false);
    }
  };
  const tasks = useMemo(
    () => rows.map((r) => toOfficialTask(r.task, r.roomName, [])),
    [rows],
  );
  const board = useTaskBoard(client, channelTasks, rows, (task) => {
    setRows((old) =>
      old.map((row) =>
        row.task.taskId === task.taskId && row.task.roomId === task.roomId
          ? { ...row, task }
          : row,
      ),
    );
  });
  const [dragged, setDragged] = useState<string>();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
  );
  const open = useCallback(
    (task: Task) => {
      if (hasRouteBoundIntent()) return;
      setParams((previous) => {
        const p = new URLSearchParams(previous);
        p.set("task", task.id);
        p.set("taskChannel", task.channelId);
        return p;
      });
    },
    [setParams],
  );
  const close = () => {
    if (hasRouteBoundIntent()) return;
    setParams((previous) => {
      const p = new URLSearchParams(previous);
      p.delete("task");
      p.delete("taskChannel");
      return p;
    });
  };
  return (
    <TaskBoardProvider value={board}>
      {!channelTasks && <TaskBoardRouteOwner board={board} />}
      <TasksPanelRoot
        className="relative flex min-h-0 flex-1 flex-col"
        data-testid="loom-tasks-page"
      >
        {!channelTasks && (
          <div
            data-slot="panel-header"
            className="flex h-panel-header items-center gap-3 border-b border-line-muted bg-layer-panel px-5 theme-brutal:border-b-2 theme-brutal:border-black theme-brutal:bg-soft-signal theme-brutal:md:bg-white"
          >
            <div className="hidden md:flex size-icon-header items-center justify-center border border-line-muted bg-primary-soft text-primary-strong theme-brutal:border-2 theme-brutal:border-black theme-brutal:bg-soft-signal theme-brutal:text-black">
              <CheckSquare size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-bold text-base leading-tight">任务</h2>
              <p className="text-xs text-foreground-muted font-mono">
                {loading ? "加载中…" : `${rows.length} / ${total} 项频道任务`}
              </p>
            </div>
          </div>
        )}
        <TasksPanelToolbar>
          <div className="flex flex-wrap items-center gap-2">
            {!channelTasks && (
              <div ref={filterHost} className="relative">
                <Button
                  size="sm"
                  variant={roomId ? "primary" : "outline"}
                  type="button"
                  onClick={() => setFilter((v) => !v)}
                  className="box-border h-8 min-h-8 gap-2 py-0"
                  aria-label="筛选频道"
                >
                  <Hash size={12} />
                  {rooms.find((r) => r.roomId === roomId)?.name ?? "频道"}
                  <ChevronDown size={12} />
                </Button>
                {filter && (
                  <SelectionPopover
                    title="频道"
                    searchable
                    search={search}
                    onSearchChange={setSearch}
                    searchPlaceholder="搜索频道"
                    showClear={!!roomId}
                    onClear={() => {
                      update("taskRoom", "");
                      setFilter(false);
                    }}
                    options={rooms
                      .filter((r) =>
                        r.name.toLowerCase().includes(search.toLowerCase()),
                      )
                      .map((r) => ({
                        key: r.roomId,
                        label: `#${r.name}`,
                        checked: roomId === r.roomId,
                        onClick: () => {
                          update("taskRoom", r.roomId);
                          setFilter(false);
                        },
                      }))}
                  />
                )}
              </div>
            )}
            {channelTasks &&
              !channelTasks.channel.room.state.snapshot?.room.archivedAt && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!hasRouteBoundIntent()) setCreating(true);
                  }}
                  className="box-border inline-flex h-8 min-h-8 items-center gap-1 py-0 text-xs font-bold"
                >
                  <Plus size={12} />
                  {formatMessage({ id: "task.board.newTask" })}
                </Button>
              )}
            <SegmentedControl
              value={mode}
              onValueChange={(value) => update("taskView", value)}
              aria-label="任务视图"
              className="sm:ml-auto"
            >
              {(["board", "list"] as const).map((value) => (
                <SegmentedControlItem
                  key={value}
                  value={value}
                  data-testid={`channel-task-view-${value}`}
                  render={(props) => (
                    <Button
                      {...props}
                      size="sm"
                      variant={mode === value ? "primary" : "outline"}
                      className="box-border h-8 min-h-8 gap-1.5 py-0"
                    />
                  )}
                >
                  {value === "board" ? (
                    <Columns3 size={12} />
                  ) : (
                    <LayoutList size={12} />
                  )}
                  <SegmentedControlLabel>
                    {value === "board" ? "看板" : "列表"}
                  </SegmentedControlLabel>
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          </div>
        </TasksPanelToolbar>
        <TaskBoardNotice board={board} reload={() => setTick((v) => v + 1)} />
        <TasksPanelViewport
          ref={scroll}
          data-task-virtual-scroll
          className="flex-1 overflow-auto bg-layer-canvas-muted p-4 safe-bottom theme-brutal:bg-white mobile-nav-clearance"
        >
          {error && (
            <div role="alert" className="mb-4 text-sm">
              {error}
              <Button onClick={() => setTick((v) => v + 1)}>重新读取</Button>
            </div>
          )}
          {loading ? (
            <div role="status" aria-label="正在读取任务">
              {[0, 1, 2, 3, 4].map((i) => (
                <SkeletonRow
                  key={i}
                  className="gap-2 rounded border border-line-muted bg-layer-card p-3 theme-brutal:border-2 theme-brutal:border-black/30 theme-brutal:bg-white"
                  lineWidths={["w-1/2", "w-3/4"]}
                />
              ))}
            </div>
          ) : !error && !tasks.length ? (
            <EmptyState
              className="flex h-full flex-col items-center justify-center"
              icon={<CheckSquare size={36} />}
              title="暂无任务"
            />
          ) : (
            <DndContext
              sensors={sensors}
              onDragStart={({ active }) => setDragged(String(active.id))}
              onDragCancel={() => setDragged(undefined)}
              onDragEnd={({ active, over }) => {
                setDragged(undefined);
                const task = tasks.find((t) => t.id === active.id);
                if (
                  task &&
                  over &&
                  statuses.includes(over.id as TaskWorkflowStatus)
                )
                  void board.update(task, over.id as TaskWorkflowStatus);
              }}
            >
              <TaskVirtualLayout
                scrollElementRef={scroll}
                className={
                  mode === "board"
                    ? "flex min-w-max items-start gap-4 pr-4"
                    : "space-y-6"
                }
                data-testid={
                  mode === "board"
                    ? "channel-task-board-view"
                    : "channel-task-list-view"
                }
              >
                {statuses.map((status) => {
                  const common = {
                    status,
                    collapsed: !!collapsed[status],
                    onToggleCollapsed: () =>
                      setCollapsed((v) => ({ ...v, [status]: !v[status] })),
                    scrollElementRef: scroll,
                  };
                  const group = tasks.filter((t) => t.status === status);
                  return mode === "board" ? (
                    <DroppableColumn
                      key={status}
                      {...common}
                      statusTasks={group}
                      openTask={open}
                      isChannelMode={Boolean(channelTasks)}
                      canModifyTasks={
                        board.state === "idle" &&
                        tasks.some(
                          (task) =>
                            board.canEdit(task) &&
                            (!dragged ||
                              (task.id === dragged &&
                                board.options(task).includes(status))),
                        )
                      }
                    />
                  ) : (
                    <TaskSection
                      key={status}
                      {...common}
                      tasks={group}
                      showChannelName={!channelTasks}
                      onOpenTask={open}
                    />
                  );
                })}
              </TaskVirtualLayout>
            </DndContext>
          )}
          {next && (
            <Button
              className="mt-4 box-border h-8 min-h-8 w-full gap-1 py-0 text-xs"
              variant="outline"
              disabled={loadingMore || rows.length >= 500}
              onClick={() => void more()}
            >
              {rows.length >= 500
                ? "已显示500项，请筛选频道"
                : loadingMore
                  ? "加载中…"
                  : "加载更多任务"}
            </Button>
          )}
        </TasksPanelViewport>
        {creating && channelTasks && (
          <TaskCreate
            facade={channelTasks}
            changed={() => setTick((v) => v + 1)}
            onClose={() => setCreating(false)}
          />
        )}
        {!channelTasks && params.get("task") && params.get("taskChannel") && (
          <TaskDetail
            key={`${params.get("taskChannel")}:${params.get("task")}`}
            client={client}
            roomId={params.get("taskChannel")!}
            taskId={params.get("task")!}
            canManage={
              rows.find((r) => r.task.taskId === params.get("task"))
                ?.canManageAnyTask ?? false
            }
            onClose={close}
            onChanged={() => setTick((v) => v + 1)}
          />
        )}
      </TasksPanelRoot>
    </TaskBoardProvider>
  );
}
