import type { RahClient } from "@rah-os/client-sdk";
import type { Task } from "@rah-os/protocol";
import {
  RoomSession,
  runRoomMutationAtLatest,
  type RoomMutationSequenceSession,
} from "@rah-os/client-core";

export type TaskAssigneeIntent =
  { kind: "assign"; assigneeId: string } | { kind: "unassign" };
export function taskAssigneeMode(
  _task: Task,
  principalId: string | undefined,
): "idle" | "readonly" {
  return principalId === undefined ? "readonly" : "idle";
}

/** One UI command identity. After an uncertain response, replay exactly the first
 * causal command: the Kernel either returns its receipt or rejects its old seq.
 * We never refresh that uncertain mutation into an overwrite of later work. */
export function createTaskAssigneeCommand(input: {
  client: RahClient;
  task: Task;
  principalId: string | undefined;
  intent: TaskAssigneeIntent;
  idempotencyKey: string;
  session?: RoomMutationSequenceSession;
}) {
  const { client, task, intent, idempotencyKey } = input;
  const session =
    input.session ??
    new RoomSession({
      client,
      roomId: task.roomId,
      consumerId: `task-assignee-${idempotencyKey}`,
    });
  let attemptedSeq: number | undefined;
  const mutate = (basedOnRoomSeq: number) => {
    const common = { taskId: task.taskId, idempotencyKey, basedOnRoomSeq };
    return intent.kind === "unassign"
      ? client.request("task.unassign", common)
      : client.request("task.assign", {
          ...common,
          assigneeId: intent.assigneeId,
        });
  };
  return async () => {
    if (attemptedSeq !== undefined) return mutate(attemptedSeq);
    return runRoomMutationAtLatest({
      session,
      mutate: async (seq) => {
        const [health, result] = await Promise.all([
          client.request("health", {}),
          client.request("task.get", {
            roomId: task.roomId,
            taskId: task.taskId,
          }),
        ]);
        const current = result.task;
        if (
          current.roomId !== task.roomId ||
          current.taskId !== task.taskId ||
          current.updatedAt !== task.updatedAt ||
          current.state !== task.state ||
          current.assigneeId !== task.assigneeId ||
          current.claimedBy !== task.claimedBy
        )
          throw new Error("任务已发生变化，请刷新后重试");
        const mode = taskAssigneeMode(current, input.principalId);
        if (!health.capabilities.taskWrite || mode !== "idle")
          throw new Error("当前任务不允许此负责人操作");
        attemptedSeq = seq;
        try {
          return await mutate(seq);
        } catch (failure) {
          if (
            typeof failure === "object" &&
            failure !== null &&
            "code" in failure &&
            failure.code === "stale_context" &&
            "status" in failure &&
            failure.status === 409
          )
            attemptedSeq = undefined;
          throw failure;
        }
      },
    });
  };
}
