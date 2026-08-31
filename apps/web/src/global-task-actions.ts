import type { RahClient } from "@rah-os/client-sdk";
import type { Task } from "@rah-os/protocol";
import {
  RoomSession,
  runRoomMutationAtLatest,
  type RoomMutationSequenceSession,
} from "@rah-os/client-core";
import {
  canHumanCancelTask,
  canHumanReopenTask,
  canHumanCompleteTask,
  type TaskColumnId,
} from "@rah-os/ui-web";
import { raftTaskGroup } from "./global-discovery-model.ts";

type Transition = {
  operation?: "task.cancel" | "task.reopen" | "task.complete";
  reason?: string;
};
/** UI affordance only. Existing Kernel commands remain the sole state-machine owner. */
export function globalTaskTransition(
  task: Task,
  target: TaskColumnId,
  principalId: string | undefined,
): Transition {
  if (raftTaskGroup(task.state) === target) return { reason: "已处于此状态" };
  const input = {
    task,
    currentPrincipalId: principalId,
    caughtUp: true,
    taskWrite: true,
  };
  if (task.creatorId !== principalId)
    return { reason: "只有任务创建者可以操作" };
  if (target === "closed" && canHumanCancelTask(input))
    return { operation: "task.cancel" };
  if (target === "todo" && canHumanReopenTask(input))
    return { operation: "task.reopen" };
  if (target === "done" && task.state === "submitted")
    return { operation: "task.complete" };
  return {
    reason:
      target === "in-progress"
        ? "进行中由 Agent 领取和执行产生"
        : target === "review"
          ? "待确认需要 Agent 提交结果"
          : target === "done"
            ? "完成需要已提交结果及必要审阅"
            : "当前状态不能直接转换；请打开任务处理",
  };
}

/** Global views have no active Room projection: synchronize the card's Room,
 * re-read evidence, then reuse canonical mutation commands without optimistic writes. */
export async function applyGlobalTaskTransition(input: {
  client: RahClient;
  task: Task;
  target: TaskColumnId;
  principalId: string | undefined;
  idempotencyKey: string;
  reason?: string;
  session?: RoomMutationSequenceSession;
}) {
  const { client, task, target, principalId, idempotencyKey } = input;
  const intent = globalTaskTransition(task, target, principalId);
  if (!intent.operation) throw new Error(intent.reason);
  if (intent.operation === "task.cancel" && !input.reason?.trim())
    throw new Error("请填写关闭原因");
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
        current.updatedAt !== task.updatedAt ||
        current.assigneeId !== task.assigneeId
      )
        throw new Error("任务已发生变化，请刷新后重试");
      if (!health.capabilities.taskWrite)
        throw new Error("当前后端未开放任务写入");
      const allowed = globalTaskTransition(current, target, principalId);
      if (allowed.operation !== intent.operation)
        throw new Error(allowed.reason ?? "任务操作已不可用");
      const command = { taskId: task.taskId, basedOnRoomSeq, idempotencyKey };
      if (intent.operation === "task.complete") {
        const evidence = await client.request("task.review.list", {
          roomId: task.roomId,
        });
        if (
          !canHumanCompleteTask({
            task: current,
            currentPrincipalId: principalId,
            caughtUp: true,
            taskWrite: true,
            ...evidence,
          })
        )
          throw new Error("尚未满足当前提交的审阅要求，请打开任务查看");
        return client.request("task.complete", command);
      }
      return intent.operation === "task.cancel"
        ? client.request("task.cancel", {
            ...command,
            reason: input.reason!.trim(),
          })
        : client.request("task.reopen", command);
    },
  });
}
