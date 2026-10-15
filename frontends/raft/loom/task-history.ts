import type { RahClient } from "@rah-os/client-sdk";
import type { ClientTaskHistoryResponse, Principal } from "@rah-os/protocol";
import type { TaskHistoryEvent } from "../packages/web/src/store/taskStore.ts";
type Entry = ClientTaskHistoryResponse["events"][number];
const names: Record<string, string> = {
  "task.claimed": "领取任务",
  "task.started": "开始任务",
  "task.progressed": "任务进度",
  "task.blocked": "任务阻塞",
  "task.unblocked": "解除阻塞",
  "task.submitted": "提交任务",
  "task.released": "释放任务",
  "review.submitted": "提交审核",
  "input.requested": "请求输入",
  "input.resolved": "输入已处理",
  "input.cancelled": "输入已取消",
  "input.expired": "输入已过期",
};
export function toTaskHistoryEvent(
  e: Entry,
  taskNumber: number,
  members: readonly Principal[],
): TaskHistoryEvent {
  const actor = members.find((p) => p.principalId === e.actorId),
    assignee = members.find((p) => p.principalId === e.assigneeId);
  const type =
    (
      {
        "task.created": "created",
        "task.amended": "amended",
        "task.assigned": "assignee_changed",
        "task.unassigned": "assignee_changed",
        "task.workflow_updated": "status_changed",
        "task.completed": "status_changed",
        "task.cancelled": "closed",
        "task.reopened": "reopened",
      } as Record<string, string>
    )[e.type] ??
    names[e.type] ??
    "其他任务变更";
  return {
    id: e.eventId,
    eventType: type,
    actorType: actor?.kind === "agent" ? "agent" : "user",
    actorName: actor?.displayName ?? actor?.handle ?? "已离开的成员",
    createdAt: e.createdAt,
    payload: {
      ...(type === "created"
        ? { taskNumber, status: e.workflowStatus ?? "todo" }
        : {}),
      ...(type === "assignee_changed"
        ? {
            assigneeId: e.assigneeId ?? null,
            assigneeType: assignee?.kind === "agent" ? "agent" : "user",
          }
        : {}),
      ...(e.changes ? { changes: e.changes } : {}),
      ...(["status_changed", "closed", "reopened"].includes(type)
        ? {
            ...(e.previousWorkflowStatus
              ? { from: e.previousWorkflowStatus }
              : {}),
            ...(e.workflowStatus ? { to: e.workflowStatus } : {}),
          }
        : {}),
      ...(e.summary ? { 说明: e.summary } : {}),
      ...(e.progress ? { 进度: e.progress } : {}),
      ...(e.disposition
        ? { 审核: e.disposition === "approved" ? "通过" : "请求修改" }
        : {}),
    },
  };
}
/** Bounded UI read window over the Kernel's frozen, authenticated history cursor. */
export class TaskHistoryReader {
  readonly client: RahClient;
  readonly roomId: string;
  readonly taskId: string;
  events: Entry[] = [];
  nextCursor?: string;
  private ceiling?: number;
  private generation = 0;
  constructor(client: RahClient, roomId: string, taskId: string) {
    this.client = client;
    this.roomId = roomId;
    this.taskId = taskId;
  }
  refresh(signal?: AbortSignal) {
    return this.read(undefined, ++this.generation, signal);
  }
  older(signal?: AbortSignal) {
    if (!this.nextCursor || this.events.length >= 500) return Promise.resolve();
    return this.read(this.nextCursor, this.generation, signal);
  }
  private async read(
    cursor: string | undefined,
    generation: number,
    signal?: AbortSignal,
  ) {
    const page = await this.client.request(
      "task.history",
      {
        roomId: this.roomId,
        taskId: this.taskId,
        limit: 50,
        ...(cursor ? { cursor } : {}),
      },
      { signal },
    );
    if (signal?.aborted || generation !== this.generation) return;
    if (page.taskId !== this.taskId) throw Error("历史不属于当前任务");
    if (cursor && page.frozenThroughRoomSeq !== this.ceiling)
      throw Error("任务历史读取范围发生变化");
    const boundary = cursor ? this.events.at(-1)?.roomSeq : undefined;
    let previous = boundary ?? page.frozenThroughRoomSeq + 1;
    for (const event of page.events) {
      if (event.roomSeq >= previous) throw Error("任务历史顺序不一致");
      previous = event.roomSeq;
    }
    this.events = cursor ? [...this.events, ...page.events] : page.events;
    this.ceiling = page.frozenThroughRoomSeq;
    this.nextCursor = page.nextCursor;
  }
}
