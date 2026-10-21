import TaskFilters from "./TaskFilters.tsx";
import {
  taskFilterRequest,
  changeTaskFilter,
  type TaskFilterKey,
} from "./task-filters.ts";
import { uiActionProps } from "./ui-action-props.ts";
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
  PanelSectionHeader,
  PanelHeaderContent,
  PanelTitle,
  PanelMeta,
  TasksPanelRoot,
  TasksPanelToolbar,
  TasksPanelViewport,
  Button,
  Card,
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlLabel,
} from "raft-ui";
import { CheckSquare, Columns3, LayoutList, Plus } from "lucide-react";
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
  TaskSection,
  DroppableColumn,
} from "./OfficialTaskBoard.generated.tsx";
import { TaskVirtualLayout } from "../packages/web/src/components/task/VirtualizedTaskStack.tsx";
import { SkeletonRow } from "../packages/web/src/components/ui/Skeleton.tsx";
import EmptyState from "../packages/web/src/components/ui/EmptyState.tsx";
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
  const filterKey = JSON.stringify(
    taskFilterRequest(params, channelTasks?.channel.roomId),
  );
  const filters = useMemo(
    () => JSON.parse(filterKey) as ReturnType<typeof taskFilterRequest>,
    [filterKey],
  );
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
  const scroll = useRef<HTMLDivElement>(null);
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
  const changeFilter = (key: TaskFilterKey, values: string[]) => {
    if (hasRouteBoundIntent()) return;
    setParams((previous) => changeTaskFilter(previous, key, values));
  };
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
        { workspaceId, limit: 50, ...filters },
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
  }, [client, workspaceId, filters, tick]);
  const more = async () => {
    if (!next || loadingMore || rows.length >= 500) return;
    const id = generation.current;
    setLoadingMore(true);
    try {
      const result = await client.request("task.global.list", {
        workspaceId,
        cursor: next,
        limit: 50,
        ...filters,
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
          <PanelSectionHeader data-loom-root-header>
            <PanelHeaderContent>
              <PanelTitle render={<h2>任务</h2>} />
              <PanelMeta render={<p />}>
                {loading ? (
                  "加载中…"
                ) : (
                  <>
                    <span className="font-mono">{total}</span> 个频道任务
                  </>
                )}
              </PanelMeta>
            </PanelHeaderContent>
          </PanelSectionHeader>
        )}
        <TasksPanelToolbar>
          <div className="flex flex-wrap items-center gap-2">
            <TaskFilters
              client={client}
              workspaceId={workspaceId}
              rooms={rooms}
              params={params}
              onChange={changeFilter}
              channelMode={!!channelTasks}
              onClear={() => {
                if (hasRouteBoundIntent()) return;
                setParams((previous) => {
                  const next = new URLSearchParams(previous);
                  next.delete("taskCreator");
                  next.delete("taskAssignee");
                  if (!channelTasks) next.delete("taskRoom");
                  return next;
                });
              }}
            />
            {channelTasks &&
              !channelTasks.channel.room.state.snapshot?.room.archivedAt && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!hasRouteBoundIntent()) setCreating(true);
                  }}
                >
                  <Plus size={16} />
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
                >
                  {value === "board" ? (
                    <Columns3 size={16} aria-hidden="true" />
                  ) : (
                    <LayoutList size={16} aria-hidden="true" />
                  )}
                  <SegmentedControlLabel className="max-sm:sr-only">
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
          className={`flex-1 overflow-auto py-4 safe-bottom${channelTasks ? "" : " mobile-nav-clearance"}`}
        >
          {error && (
            <div role="alert" className="mb-4 text-sm">
              {error}
              <Button
                {...uiActionProps.recovery}
                onClick={() => setTick((v) => v + 1)}
              >
                重新读取
              </Button>
            </div>
          )}
          {loading ? (
            <div
              role="status"
              aria-label="正在读取任务"
              className="flex flex-col gap-2"
            >
              {[0, 1, 2, 3, 4].map((i) => (
                <Card
                  key={i}
                  render={<SkeletonRow lineWidths={["w-1/2", "w-3/4"]} />}
                  className="flex-row items-center gap-2 p-3"
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
              className="mt-4 w-full"
              size="sm"
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
