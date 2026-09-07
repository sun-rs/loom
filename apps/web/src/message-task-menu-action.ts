import type { Task } from "@rah-os/protocol";

import { globalTaskTransition } from "./global-task-actions.ts";

export type MessageTaskMenuAction =
  | { kind: "complete"; label: "标记为完成" }
  | { kind: "reopen"; label: "重新打开任务" }
  | {
      kind: "unavailable";
      label: "标记为完成" | "重新打开任务";
      reason: string;
    };

/**
 * Raft owns the message-menu labels and placement. The Kernel still owns what
 * those labels mean: only a submitted/reviewable Task can complete, while only
 * a safely cancelled Task can reopen. A completed delivery remains immutable.
 */
export function messageTaskMenuAction(
  task: Task,
  canManageAnyTask: boolean,
): MessageTaskMenuAction {
  const label =
    task.state === "cancelled" || task.state === "completed"
      ? ("重新打开任务" as const)
      : ("标记为完成" as const);
  if (!canManageAnyTask)
    return {
      kind: "unavailable",
      label,
      reason: "你没有管理此任务的权限",
    };
  if (task.state === "completed")
    return {
      kind: "unavailable",
      label,
      reason: "已完成任务保留 canonical 完成记录",
    };
  const target = task.state === "cancelled" ? "todo" : "done";
  const transition = globalTaskTransition(task, target, true);
  if (!transition.operation)
    return {
      kind: "unavailable",
      label,
      reason: transition.reason ?? "此任务操作不可用",
    };
  return task.state === "cancelled"
    ? { kind: "reopen", label: "重新打开任务" }
    : { kind: "complete", label: "标记为完成" };
}
