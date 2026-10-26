import type { TaskWorkflowStatus } from "@rah-os/protocol";
export function taskDropStatus(
  data: Record<string, unknown> | undefined,
): TaskWorkflowStatus | undefined {
  const value = data?.status;
  return typeof value === "string" &&
    ["todo", "in_progress", "in_review", "done", "closed"].includes(value)
    ? (value as TaskWorkflowStatus)
    : undefined;
}
export function taskDropAllowed<T extends { id: string; status: string }>(
  id: string | number,
  data: Record<string, unknown> | undefined,
  tasks: T[],
  board: {
    state: string;
    canEdit: (task: T) => boolean;
    options: (task: T) => readonly string[];
  },
): boolean {
  const status = taskDropStatus(data),
    task = tasks.find((t) => t.id === String(id));
  return (
    !!task &&
    !!status &&
    board.state === "idle" &&
    board.canEdit(task) &&
    (task.status === status || board.options(task).includes(status))
  );
}
