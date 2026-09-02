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
import type { GlobalTasksResponse, Task } from "@rah-os/protocol";
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
import { TaskCloseDialog } from "./task-dialogs.tsx";
import { Icon } from "./icon.tsx";

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
  principalId,
  view,
  onOpen,
  onChanged,
}: {
  client: RahClient;
  columns: readonly TaskColumnView[];
  tasks: GlobalTasksResponse["tasks"];
  principalId: string | undefined;
  view: "board" | "list";
  onOpen: DiscoveryNavigationHandler;
  onChanged: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    done: true,
    closed: true,
  });
  const [dragging, setDragging] = useState<Task>();
  const [pending, setPending] = useState<string>();
  const [closing, setClosing] = useState<Task>();
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
  async function perform(task: Task, target: TaskColumnId, reason?: string) {
    setPending(task.taskId);
    setError("");
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const idempotencyKey = `global-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
      await applyGlobalTaskTransition({
        client,
        task,
        target,
        principalId,
        idempotencyKey,
        ...(reason ? { reason } : {}),
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
    if (raftTaskGroup(task.state) === target) return;
    const intent = globalTaskTransition(task, target, principalId);
    setNotice("");
    setError("");
    if (!intent.operation) {
      setError(intent.reason ?? "此操作不可用");
      return;
    }
    if (target === "closed") {
      setClosing(task);
      return;
    }
    void perform(task, target).catch(() => {});
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
              globalTaskTransition(dragging, target, principalId).reason ??
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
                  ? globalTaskTransition(dragging, column.id, principalId)
                      .reason
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
                    columns={columns}
                    principalId={principalId}
                    disabled={Boolean(pending || closing)}
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
      {closing && (
        <TaskCloseDialog
          taskTitle={closing.title}
          onClose={() => setClosing(undefined)}
          onConfirm={(reason) => perform(closing, "closed", reason)}
        />
      )}
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
      {!collapsed && <div className="kcol-body">{children}</div>}
    </section>
  );
}
function TaskCard({
  task,
  roomName,
  columns,
  principalId,
  disabled,
  onChoose,
  onOpen,
}: {
  task: Task;
  roomName: string;
  columns: readonly TaskColumnView[];
  principalId: string | undefined;
  disabled: boolean;
  onChoose: (id: TaskColumnId) => void;
  onOpen: () => void;
}) {
  const group = raftTaskGroup(task.state),
    column = columns.find((item) => item.id === group)!;
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.taskId, disabled, data: { group } });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      onKeyDown={undefined}
      data-task-id={task.taskId}
      className={`kcard rah-global-task-card${isDragging ? " is-dragging" : ""}`}
      style={{ transform: CSS.Translate.toString(transform) }}
    >
      <button
        {...attributes}
        onKeyDown={(event) => listeners?.onKeyDown?.(event)}
        className="rah-task-drag-handle"
        aria-label={`移动任务 #${task.taskNumber}`}
        disabled={disabled}
      >
        <Icon name="grip-vertical" />
      </button>
      <button
        className="rah-global-card-open"
        onClick={onOpen}
        disabled={disabled}
      >
        <span className="kcard-no">
          <b>#{roomName}</b> <span>#{task.taskNumber}</span>
        </span>
        <p className="kcard-title">{task.title}</p>
        {task.description && (
          <p className="rah-global-card-description">{task.description}</p>
        )}
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
          className={`rah-task-status-picker chip-${column.tone}`}
          disabled={disabled}
          values={[group]}
          selected={false}
          options={columns.map((item) => ({
            id: item.id,
            label: item.label,
            ...(item.id !== group
              ? {
                  disabledReason: globalTaskTransition(
                    task,
                    item.id,
                    principalId,
                  ).reason,
                }
              : {}),
          }))}
          onChange={(values) => onChoose(values[0] as TaskColumnId)}
        />
      </div>
    </div>
  );
}
