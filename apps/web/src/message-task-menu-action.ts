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

/** Message actions share the canonical Human status editor. */
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
  const reopen = task.state === "cancelled" || task.state === "completed";
  const target = reopen ? "todo" : "done";
  const transition = globalTaskTransition(task, target, true);
  if (!transition.operation)
    return {
      kind: "unavailable",
      label,
      reason: transition.reason ?? "此任务操作不可用",
    };
  return reopen
    ? { kind: "reopen", label: "重新打开任务" }
    : { kind: "complete", label: "标记为完成" };
}
