import type { RahClient } from "@rah-os/client-sdk";
import {
  taskWorkflowStatus,
  type Task,
  type TaskWorkflowStatus,
} from "@rah-os/protocol";
import {
  RoomSession,
  runRoomMutationAtLatest,
  type RoomMutationSequenceSession,
} from "@rah-os/client-core";
import type { TaskColumnId } from "@rah-os/ui-web";

type Transition = {
  operation?: "task.workflow.update";
  reason?: string;
};
/** Raft exposes one five-state editor; the Kernel remains the lifecycle owner. */
export function globalTaskTransition(
  task: Task,
  target: TaskColumnId,
  canManageAnyTask: boolean,
): Transition {
  if (!canManageAnyTask) return { reason: "你没有管理此任务的权限" };
  const current = taskWorkflowStatus(task.state);
  const requested = workflowStatus(target);
  if (requested === current) return { reason: "任务已处于此状态" };
  if (
    requested === "closed" &&
    !["completed", "cancelled"].includes(task.state)
  )
    return { operation: "task.workflow.update" };
  if (requested === "todo" && task.state === "cancelled")
    return { operation: "task.workflow.update" };
  if (requested === "done" && task.state === "submitted")
    return { operation: "task.workflow.update" };
  if (requested === "in_progress")
    return { reason: "进行中状态由真实认领与执行产生" };
  if (requested === "in_review")
    return { reason: "待确认状态由 Agent 提交冻结成果产生" };
  if (requested === "done")
    return { reason: "只有已提交且满足审阅要求的任务才能完成" };
  if (requested === "todo")
    return { reason: "只有已关闭且完成停止证明的任务才能重开" };
  return { reason: "已完成或已关闭的任务不能再次关闭" };
}

function workflowStatus(target: TaskColumnId): TaskWorkflowStatus {
  return target === "in-progress"
    ? ("in_progress" as const)
    : target === "review"
      ? ("in_review" as const)
      : target;
}

/** Global views have no active Room projection: synchronize the card's Room,
 * re-read evidence, then reuse canonical mutation commands without optimistic writes. */
export async function applyGlobalTaskTransition(input: {
  client: RahClient;
  task: Task;
  target: TaskColumnId;
  canManageAnyTask: boolean;
  idempotencyKey: string;
  session?: RoomMutationSequenceSession;
}) {
  const { client, task, target, canManageAnyTask, idempotencyKey } = input;
  const intent = globalTaskTransition(task, target, canManageAnyTask);
  if (!intent.operation) throw new Error(intent.reason);
  const session =
    input.session ??
    new RoomSession({
      client,
      roomId: task.roomId,
      consumerId: `global-task-${idempotencyKey}`,
    });
  await runRoomMutationAtLatest({
    session,
    mutate: async (basedOnRoomSeq) => {
      const [health, currentResult] = await Promise.all([
        client.request("health", {}),
        client.request("task.get", {
          roomId: task.roomId,
          taskId: task.taskId,
        }),
      ]);
      const current = currentResult.task;
      if (
        !current ||
        current.roomId !== task.roomId ||
        current.state !== task.state ||
        current.workflowStatus !== task.workflowStatus ||
        current.updatedAt !== task.updatedAt ||
        current.assigneeId !== task.assigneeId
      )
        throw new Error("任务已发生变化，请刷新后重试");
      if (!health.capabilities.taskWrite)
        throw new Error("当前后端未开放任务写入");
      const allowed = globalTaskTransition(current, target, canManageAnyTask);
      if (allowed.operation !== intent.operation)
        throw new Error(allowed.reason ?? "任务操作已不可用");
      return client.request("task.workflow.update", {
        taskId: task.taskId,
        basedOnRoomSeq,
        idempotencyKey,
        workflowStatus: workflowStatus(target),
      });
    },
  });
}
