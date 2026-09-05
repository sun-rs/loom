import { useState } from "react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { RahClient } from "@rah-os/client-sdk";
import type { Task } from "@rah-os/protocol";
import type { TaskColumnId, TaskColumnView } from "@rah-os/ui-web";
import {
  globalTaskTransition,
  applyGlobalTaskTransition,
} from "../global-task-actions.ts";
import {
  raftTaskGroup,
  type DiscoveryNavigationHandler,
} from "../global-discovery-model.ts";
import { DiscoveryFilter } from "./discovery-filter.tsx";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";

const ids: TaskColumnId[] = ["todo", "in-progress", "review", "done", "closed"];
// Arrow navigation crosses semantic groups, rather than requiring 13 x 25px nudges.
const groupCoordinates: KeyboardCoordinateGetter = (
  event,
  { currentCoordinates, context },
) => {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.code))
    return undefined;
  event.preventDefault();
  const index = ids.indexOf(
    (context.over?.id ?? context.active?.data.current?.group) as TaskColumnId,
  );
  const next =
    ids[index + (["ArrowRight", "ArrowDown"].includes(event.code) ? 1 : -1)];
  const rect = next && context.droppableRects.get(next),
    active = context.collisionRect;
  return rect && active
    ? {
        x:
          currentCoordinates.x +
          rect.left +
          rect.width / 2 -
          active.left -
          active.width / 2,
        y:
          currentCoordinates.y +
          rect.top +
          rect.height / 2 -
          active.top -
          active.height / 2,
      }
    : undefined;
};

export function GlobalTaskBoard({
  client,
  columns,
  tasks,
  view,
  writeEnabled = true,
  showRoomName = true,
  onOpen,
  onChanged,
}: {
  client: RahClient;
  columns: readonly TaskColumnView[];
  tasks: readonly {
    canManageAnyTask: boolean;
    roomName: string;
    task: Task;
  }[];
  view: "board" | "list";
  writeEnabled?: boolean;
  showRoomName?: boolean;
  onOpen: DiscoveryNavigationHandler;
  onChanged: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    done: true,
    closed: true,
  });
  const [dragging, setDragging] = useState<Task>();
  const [pending, setPending] = useState<string>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  // Direct Raft Vie sensor settings (not a home-grown drag engine).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: groupCoordinates }),
  );
  const canManage = (task: Task) =>
    tasks.find((item) => item.task.taskId === task.taskId)?.canManageAnyTask ??
    false;
  async function perform(
    task: Task,
    target: TaskColumnId,
    canManageAnyTask: boolean,
  ) {
    setPending(task.taskId);
    setError("");
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const idempotencyKey = `global-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
      await applyGlobalTaskTransition({
        client,
        task,
        target,
        canManageAnyTask,
        idempotencyKey,
      });
      onChanged();
      setNotice(`任务 #${task.taskNumber} 已更新`);
    } catch (failure) {
      const message =
        failure instanceof Error ? failure.message : "操作失败，请重试";
      setError(message);
      throw failure;
    } finally {
      setPending(undefined);
    }
  }
  function choose(task: Task, target: TaskColumnId) {
    if (raftTaskGroup(task) === target) return;
    const canManageAnyTask = canManage(task);
    const intent = globalTaskTransition(task, target, canManageAnyTask);
    setNotice("");
    setError("");
    if (!intent.operation) {
      setError(intent.reason ?? "此操作不可用");
      return;
    }
    void perform(task, target, canManageAnyTask).catch(() => {});
  }
  return (
    <>
      {error && (
        <p role="alert" className="rah-inline-error">
          {error}
        </p>
      )}
      <p role="status" className="rah-task-drag-notice">
        {pending ? "正在核验并保存任务…" : notice}
      </p>
      <DndContext
        sensors={sensors}
        onDragStart={({ active }) => {
          const task = tasks.find(
            (item) => item.task.taskId === active.id,
          )?.task;
          setDragging(task);
          setError("");
          setNotice("拖至目标状态；Esc 取消");
        }}
        onDragOver={({ over }) => {
          if (dragging && over) {
            const target = over.id as TaskColumnId;
            setNotice(
              globalTaskTransition(dragging, target, canManage(dragging))
                .reason ??
                `释放后${columns.find((column) => column.id === target)?.label}`,
            );
          }
        }}
        onDragCancel={() => {
          setDragging(undefined);
          setNotice("已取消拖动，任务未改变");
        }}
        onDragEnd={({ active, over }) => {
          const task =
            dragging ??
            tasks.find((item) => item.task.taskId === active.id)?.task;
          setDragging(undefined);
          setNotice("");
          if (task && over && ids.includes(over.id as TaskColumnId))
            choose(task, over.id as TaskColumnId);
        }}
      >
        <div
          className={`kanban rah-global-kanban${view === "list" ? " list-mode" : ""}`}
        >
          {columns.map((column) => (
            <TaskGroup
              key={column.id}
              column={column}
              collapsed={Boolean(collapsed[column.id])}
              onToggle={() =>
                setCollapsed((old) => ({
                  ...old,
                  [column.id]: !old[column.id],
                }))
              }
              rejection={
                dragging
                  ? globalTaskTransition(
                      dragging,
                      column.id,
                      canManage(dragging),
                    ).reason
                  : undefined
              }
            >
              {[...column.tasks]
                .sort((a, b) => b.taskNumber - a.taskNumber)
                .map((task) => (
                  <TaskCard
                    key={task.taskId}
                    task={task}
                    roomName={
                      tasks.find((item) => item.task.taskId === task.taskId)
                        ?.roomName ?? ""
                    }
                    showRoomName={showRoomName}
                    columns={columns}
                    canManageAnyTask={canManage(task)}
                    disabled={Boolean(pending) || !writeEnabled}
                    onChoose={(target) => choose(task, target)}
                    onOpen={() =>
                      onOpen({
                        target: {
                          kind: "task",
                          roomId: task.roomId,
                          rootMessageId: task.sourceMessageId,
                          taskId: task.taskId,
                          threadId: task.threadId,
                        },
                      })
                    }
                  />
                ))}
              {!column.tasks.length && (
                <p className="rah-empty-copy">没有{column.label}的任务。</p>
              )}
            </TaskGroup>
          ))}
        </div>
      </DndContext>
    </>
  );
}

function TaskGroup({
  column,
  collapsed,
  onToggle,
  rejection,
  children,
}: {
  column: TaskColumnView;
  collapsed: boolean;
  onToggle: () => void;
  rejection: string | undefined;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  return (
    <section
      ref={setNodeRef}
      data-task-group={column.id}
      className={`kcol${isOver ? (rejection ? " is-rejected" : " is-over") : ""}`}
    >
      <button
        className="kcol-head"
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? "展开" : "收起"}${column.label}`}
        onClick={onToggle}
      >
        <span className={`rah-global-group-label chip-${column.tone}`}>
          {column.label}
        </span>
        <span>{column.tasks.length}</span>
        <Icon name="chevron-down" />
      </button>
      {!collapsed && (
        <div className="kcol-body rah-interaction-shadow-host">{children}</div>
      )}
    </section>
  );
}
function TaskCard({
  task,
  roomName,
  showRoomName,
  columns,
  canManageAnyTask,
  disabled,
  onChoose,
  onOpen,
}: {
  task: Task;
  roomName: string;
  showRoomName: boolean;
  columns: readonly TaskColumnView[];
  canManageAnyTask: boolean;
  disabled: boolean;
  onChoose: (id: TaskColumnId) => void;
  onOpen: () => void;
}) {
  const group = raftTaskGroup(task),
    column = columns.find((item) => item.id === group)!,
    canEdit = columns.some(
      (item) =>
        globalTaskTransition(task, item.id, canManageAnyTask).operation !==
        undefined,
    );
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: task.taskId,
    disabled: disabled || !canEdit,
    data: { group },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      data-task-id={task.taskId}
      data-testid="task-board-draggable-card"
      className={`rah-global-task-drag-shell${isDragging ? " is-dragging" : ""}`}
      style={{ transform: CSS.Translate.toString(transform) }}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        className="rah-task-drag-handle"
        aria-label={`移动任务 #${task.taskNumber}`}
        disabled={disabled || !canEdit}
      >
        <Icon name="grip-vertical" />
      </button>
      <div
        draggable={false}
        className="kcard rah-global-task-card rah-interaction-brutal"
        data-task-workflow-status={group}
      >
        <button
          className="rah-global-card-open"
          onClick={onOpen}
          disabled={disabled}
        >
          <div className="rah-global-card-row">
            <div className="rah-global-card-main">
              <div className="kcard-no">
                {showRoomName ? <b>#{roomName}</b> : null}
                <span>#{task.taskNumber}</span>
              </div>
              <p className="kcard-title">{task.title}</p>
              {task.description && (
                <p className="rah-global-card-description">
                  {task.description}
                </p>
              )}
            </div>
          </div>
        </button>
        <div
          className="rah-global-card-footer"
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
        >
          <DiscoveryFilter
            label={`任务 #${task.taskNumber} 状态`}
            triggerLabel={column.label}
            icon={null}
            multiple={false}
            searchable={false}
            clearable={false}
            variant="status"
            className="rah-task-state rah-task-status-picker"
            triggerClassName={`chip-${column.tone}`}
            disabled={disabled || !canManageAnyTask}
            values={[group]}
            selected={false}
            options={columns.map((item) => {
              const reason = globalTaskTransition(
                task,
                item.id,
                canManageAnyTask,
              ).reason;
              return {
                id: item.id,
                label: item.label,
                ...(item.id === group || reason === undefined
                  ? {}
                  : { disabledReason: reason }),
              };
            })}
            onChange={(values) => onChoose(values[0] as TaskColumnId)}
          />
        </div>
      </div>
    </div>
  );
}
