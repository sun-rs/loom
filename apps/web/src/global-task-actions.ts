import type { RahClient } from "@rah-os/client-sdk";
import {
  taskWorkflowStatus,
  taskWorkflowTransitionOptions,
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
/** Raft exposes one five-state status editor. Execution evidence is orthogonal. */
export function globalTaskTransition(
  task: Task,
  target: TaskColumnId,
  canManageAnyTask: boolean,
): Transition {
  return taskWorkflowTransitionOptions(
    taskWorkflowStatus(task),
    canManageAnyTask,
  ).includes(workflowStatus(target))
    ? { operation: "task.workflow.update" }
    : { reason: "Raft 当前工作流不允许迁移到此状态" };
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
      const [health, list] = await Promise.all([
        client.request("health", {}),
        client.request("task.list", { roomId: task.roomId }),
      ]);
      const current = list.tasks.find((item) => item.taskId === task.taskId);
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
