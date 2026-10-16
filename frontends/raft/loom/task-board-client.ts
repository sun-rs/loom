import { RoomSession } from "@rah-os/client-core";
import {
  WriteIntentSlot,
  type IntentOutcome,
} from "@rah-os/client-core/write-intent";
import type { RahClient } from "@rah-os/client-sdk";
import {
  taskWorkflowStatus,
  taskWorkflowTransitionOptions,
  type GlobalTasksResponse,
  type ClientTaskAttentionMutationResponse,
  type TaskWorkflowStatus,
} from "@rah-os/protocol";
import type { ChannelTaskClient } from "./channel-task-client.ts";
export type TaskBoardRow = GlobalTasksResponse["tasks"][number];
export function canEditBoardTask(
  row: TaskBoardRow | undefined,
  principalId: string | undefined,
) {
  return Boolean(
    row &&
    principalId &&
    (row.canManageAnyTask || row.task.creatorId === principalId),
  );
}
/** One UI intent owner, using the channel's existing slot when embedded. */
export class TaskBoardClient {
  readonly writes: WriteIntentSlot;
  readonly client: RahClient;
  readonly channel?: ChannelTaskClient;
  constructor(client: RahClient, channel?: ChannelTaskClient) {
    this.client = client;
    this.channel = channel;
    this.writes = channel?.channel.writes ?? new WriteIntentSlot();
  }
  update(
    row: TaskBoardRow,
    status: TaskWorkflowStatus,
    principalId: string | undefined,
    done: (result: IntentOutcome<ClientTaskAttentionMutationResponse>) => void,
  ) {
    if (!canEditBoardTask(row, principalId))
      throw Error("没有修改此任务的权限");
    if (this.channel && row.task.roomId !== this.channel.channel.roomId)
      throw Error("任务不属于当前频道");
    const current = taskWorkflowStatus(row.task.state);
    if (
      !taskWorkflowTransitionOptions(current, row.canManageAnyTask).includes(
        status,
      )
    )
      throw Error("不支持此状态转换");
    if (current === status) return Promise.resolve();
    return this.writes.submit({
      action: "task-workflow",
      session:
        this.channel?.channel.room ??
        new RoomSession({
          client: this.client,
          roomId: row.task.roomId,
          consumerId: `loom-task-board:${row.task.taskId}`,
        }),
      payload: { taskId: row.task.taskId, workflowStatus: status },
      send: (p, basedOnRoomSeq, idempotencyKey) =>
        this.client.request("task.workflow.update", {
          ...p,
          basedOnRoomSeq,
          idempotencyKey,
        }),
      onSettled: done,
    });
  }
}
