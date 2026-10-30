import { layoutQueries } from "./adaptive-layout.ts";
import { useTaskDrag } from "./useTaskDrag";
import { TASK_STATUS_UI } from "../packages/web/src/components/task/taskStatusUi";
import {
  OfficialTaskToolbar,
  OfficialTasksHeader,
} from "./OfficialTaskSurfaces.generated";
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
  TaskDndProvider,
  TaskDragOverlay,
  TasksPanelRoot,
  TasksPanelViewport,
  Button,
} from "raft-ui";
import TaskLoading from "./TaskLoading";
import { ListTodo } from "lucide-react";
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
import EmptyState from "../packages/web/src/components/ui/EmptyState.tsx";
import { useMediaQuery } from "../packages/web/src/hooks/effectPrimitives.ts";
import type { Task } from "../packages/web/src/store/taskStore.ts";
import { toOfficialTask } from "./task-client.ts";
import { useIntentRoute, hasRouteBoundIntent } from "./useIntentRoute.ts";
import TaskCard from "./OfficialTaskCard.generated";
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
  active = true,
}: {
  active?: boolean;
  channelTasks?: ChannelTaskClient;
  client: RahClient;
  workspaceId: string;
  rooms: Room[];
}) {
  const { formatMessage } = useIntl();
  const [creating, setCreating] = useState(false);
  const [params, setParams] = useIntentRoute();
  const mobile = useMediaQuery(layoutQueries.compactDensity);
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
  const queryKey = JSON.stringify([workspaceId, filterKey]);
  const [loadedKey, setLoadedKey] = useState<string>();
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
    if (!active) return;
    const id = ++generation.current,
      abort = new AbortController();
    if (loadedKey !== queryKey) setRows([]);
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
        setLoadedKey(queryKey);
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
  }, [active, client, workspaceId, filters, tick]);
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
    () =>
      loadedKey === queryKey
        ? rows.map((r) => toOfficialTask(r.task, r.roomName, []))
        : [],
    [rows, loadedKey, queryKey],
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
  const drag = useTaskDrag(tasks, board);
  const draggedTask = tasks.find((t) => t.id === drag.activeTaskId);
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
          <OfficialTasksHeader
            meta={
              loading ? (
                "加载中…"
              ) : (
                <>
                  <span className="font-mono">{total}</span> 个频道任务
                </>
              )
            }
          />
        )}
        <OfficialTaskToolbar
          filters={
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
          }
          isChannelMode={!!channelTasks}
          canModifyTasks={
            !!channelTasks &&
            !channelTasks.channel.room.state.snapshot?.room.archivedAt
          }
          openCreateDialog={() => {
            if (!hasRouteBoundIntent()) setCreating(true);
          }}
          viewMode={mode}
          setView={(value) => update("taskView", value)}
        />
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
          {loadedKey !== queryKey && !error ? (
            <TaskLoading />
          ) : !error && !tasks.length ? (
            <EmptyState
              className="flex h-full flex-col items-center justify-center"
              icon={<ListTodo size={36} />}
              title={
                params.has("taskRoom") ||
                params.has("taskCreator") ||
                params.has("taskAssignee")
                  ? "没有符合此筛选的任务"
                  : "还没有任务"
              }
              description={
                params.has("taskRoom") ||
                params.has("taskCreator") ||
                params.has("taskAssignee")
                  ? "换一个筛选组合，或清除当前选择。"
                  : channelTasks
                    ? "用「创建任务」按钮创建一个。"
                    : "频道中的任务会显示在这里。"
              }
              data-testid="tasks-empty"
            />
          ) : (
            <TaskDndProvider {...drag.props}>
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
                      activeTaskId={drag.activeTaskId}
                      blockedReason={
                        draggedTask &&
                        !board.options(draggedTask).includes(status) &&
                        draggedTask.status !== status
                          ? `不能从${formatMessage({ id: TASK_STATUS_UI[draggedTask.status].labelId })}移至${formatMessage({ id: TASK_STATUS_UI[status].labelId })}`
                          : undefined
                      }
                      canModifyTasks={
                        board.state === "idle" &&
                        tasks.some((task) => board.canEdit(task))
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
              <TaskDragOverlay>
                {draggedTask ? (
                  <TaskCard
                    task={draggedTask}
                    onOpen={open}
                    showChannelName={!channelTasks}
                  />
                ) : null}
              </TaskDragOverlay>
            </TaskDndProvider>
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
        {active && creating && channelTasks && (
          <TaskCreate
            facade={channelTasks}
            changed={() => setTick((v) => v + 1)}
            onClose={() => setCreating(false)}
          />
        )}
        {active &&
          !channelTasks &&
          params.get("task") &&
          params.get("taskChannel") && (
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
