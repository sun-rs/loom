import { useIntl } from "react-intl";
import { TASK_STATUS_UI } from "../packages/web/src/components/task/taskStatusUi";
import { useEffect, useRef, useState } from "react";
import type { TaskDndProviderProps } from "raft-ui";
import type { Task } from "../packages/web/src/store/taskStore";
import type { useTaskBoard } from "./TaskBoardActions";
import { taskDropAllowed, taskDropStatus } from "./task-drag-policy";
// Web1.21.34 TasksPanel Ft: same selector and focus semantics, typed locally.
export function focusMovedTaskCard(
  id: string,
  root: Pick<Document, "querySelector"> = document,
) {
  const element = root.querySelector<HTMLElement>(
    `[data-testid="task-board-draggable-card"][data-task-id="${CSS.escape(id)}"]`,
  );
  if (!element) return false;
  element.focus({ preventScroll: false });
  return true;
}
/** Presentation-only focus state; the board's confirmed projection owns status. */
export function useTaskDrag(
  tasks: Task[],
  board: ReturnType<typeof useTaskBoard>,
) {
  const { formatMessage } = useIntl();
  const title = (id: string | number) =>
    tasks.find((task) => task.id === String(id))?.title ?? "任务";
  const [activeTaskId, setActiveTaskId] = useState<string>();
  const keyboard = useRef(false);
  const [focus, setFocus] = useState<{ id: string; status: string }>();
  useEffect(() => {
    if (
      !focus ||
      !tasks.some(
        (task) => task.id === focus.id && task.status === focus.status,
      )
    )
      return;
    const frame = requestAnimationFrame(() => {
      if (focusMovedTaskCard(focus.id)) setFocus(undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [tasks, focus]);
  const finish: NonNullable<TaskDndProviderProps["onDragEnd"]> = ({
    active,
  }) => {
    setActiveTaskId(undefined);
    if (!keyboard.current) return;
    keyboard.current = false;
    const task = tasks.find((t) => t.id === String(active.id));
    if (task) setFocus({ id: task.id, status: task.status });
  };
  const props: Omit<TaskDndProviderProps, "children"> = {
    disabled: board.state !== "idle",
    accessibility: {
      screenReaderInstructions: {
        draggable: "按空格拾起任务，方向键选择目标，空格放下，Escape取消。",
      },
      announcements: {
        onDragStart: ({ active }) => `已拾起${title(active.id)}`,
        onDragOver: ({ active, over }) => {
          const status = taskDropStatus(over?.data.current);
          if (!status) return "当前没有放置目标";
          return `${formatMessage({ id: TASK_STATUS_UI[status].labelId })}，${taskDropAllowed(active.id, over?.data.current, tasks, board) ? "可以放置" : "不能移动到这里"}`;
        },
        onDragEnd: () => "拖动结束，请以任务状态更新结果为准。",
        onDragCancel: () => "已取消拖动，任务状态未更改。",
      },
    },
    isDropAllowed: (id, _over, data) => taskDropAllowed(id, data, tasks, board),
    onDragStart: ({ active, activatorEvent }) => {
      keyboard.current = activatorEvent instanceof KeyboardEvent;
      setActiveTaskId(String(active.id));
    },
    onDragCancel: finish,
    onDragEnd: finish,
    onMove: async ({ activeId, overData }) => {
      const status = taskDropStatus(overData),
        task = tasks.find((t) => t.id === String(activeId));
      if (
        !task ||
        !status ||
        task.status === status ||
        !taskDropAllowed(activeId, overData, tasks, board)
      )
        return;
      const restore = keyboard.current;
      if (await board.update(task, status))
        if (restore) setFocus({ id: task.id, status });
    },
  };
  return { activeTaskId, props };
}
