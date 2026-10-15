import { RoomSession } from "@rah-os/client-core";
import {
  WriteIntentSlot,
  type IntentOutcome,
} from "@rah-os/client-core/write-intent";
import type { RahClient } from "@rah-os/client-sdk";
import {
  taskWorkflowStatus,
  type Task,
  type Principal,
  type TaskWorkflowStatus,
  type ClientTaskAttentionMutationResponse,
} from "@rah-os/protocol";
import type { Task as OfficialTask } from "../packages/web/src/store/taskStore.ts";
export function toOfficialTask(
  task: Task,
  roomName: string,
  members: readonly Principal[],
): OfficialTask {
  const creator = members.find((p) => p.principalId === task.creatorId),
    assignee = members.find((p) => p.principalId === task.assigneeId);
  return {
    id: task.taskId,
    messageId: task.sourceMessageId,
    channelId: task.roomId,
    channelName: roomName,
    channelType: "channel",
    taskNumber: task.taskNumber,
    title: task.title,
    description: task.description,
    status: taskWorkflowStatus(task.state),
    createdById: task.creatorId,
    createdByType: creator?.kind === "agent" ? "agent" : "user",
    createdByName: creator?.displayName ?? creator?.handle ?? "已离开的成员",
    claimedById: task.assigneeId,
    claimedByType:
      assignee?.kind === "agent" ? "agent" : assignee ? "user" : null,
    claimedByName:
      assignee?.displayName ??
      assignee?.handle ??
      (task.assigneeId ? "已离开的成员" : null),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  };
}
/** Kernel owns Task lifecycle; this facade freezes only one UI write intent. */
export class LoomTaskClient {
  readonly writes = new WriteIntentSlot();
  readonly room: RoomSession;
  readonly client: RahClient;
  readonly roomId: string;
  readonly taskId: string;
  private loaded = false;
  constructor(client: RahClient, roomId: string, taskId: string) {
    this.client = client;
    this.roomId = roomId;
    this.taskId = taskId;
    this.room = new RoomSession({
      client,
      roomId,
      consumerId: `loom-task:${taskId}`,
    });
  }
  async refresh(signal?: AbortSignal) {
    this.loaded = false;
    const [result, identity] = await Promise.all([
      this.client.request(
        "task.get",
        { roomId: this.roomId, taskId: this.taskId },
        { signal },
      ),
      this.client.request("principal.me", {}, { signal }),
      this.room.syncUntilCurrent({ signal, maxPages: 10 }),
    ]);
    if (
      result.task.roomId !== this.roomId ||
      result.task.taskId !== this.taskId
    )
      throw Error("任务不属于所选对话");
    this.loaded = true;
    return {
      task: result.task,
      principal: identity.principal,
      room: this.room.state.snapshot?.room,
      members: this.room.state.snapshot?.members ?? [],
    };
  }
  async update(
    workflowStatus: TaskWorkflowStatus,
    onSettled?: (o: IntentOutcome<ClientTaskAttentionMutationResponse>) => void,
  ) {
    if (!this.loaded) throw Error("请先读取任务");
    return this.writes.submit({
      action: "task-workflow",
      session: this.room,
      payload: { taskId: this.taskId, workflowStatus },
      send: (p, basedOnRoomSeq, idempotencyKey) =>
        this.client.request("task.workflow.update", {
          ...p,
          basedOnRoomSeq,
          idempotencyKey,
        }),
      onSettled,
    });
  }
  async assign(
    assigneeId: string | null,
    onSettled?: (o: IntentOutcome<ClientTaskAttentionMutationResponse>) => void,
  ) {
    if (!this.loaded) throw Error("请先读取任务");
    return this.writes.submit({
      action: "task-assignment",
      session: this.room,
      payload: { taskId: this.taskId, assigneeId },
      onSettled,
      send: (p, basedOnRoomSeq, idempotencyKey) =>
        p.assigneeId === null
          ? this.client.request("task.unassign", {
              taskId: p.taskId,
              basedOnRoomSeq,
              idempotencyKey,
            })
          : this.client.request("task.assign", {
              ...p,
              assigneeId: p.assigneeId,
              basedOnRoomSeq,
              idempotencyKey,
            }),
    });
  }
}
