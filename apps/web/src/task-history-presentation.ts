import type { WorkerTaskHistoryResponse } from "@rah-os/protocol";
type Entry = WorkerTaskHistoryResponse["events"][number];
export const historyStatuses = {
  todo: { label: "待办", tone: "orange" },
  in_progress: { label: "进行中", tone: "cyan" },
  in_review: { label: "待确认", tone: "lavender" },
  done: { label: "完成", tone: "lime" },
  closed: { label: "已关闭", tone: "stone" },
} as const;
export function taskHistoryOperations(events: readonly Entry[]) {
  return [...events]
    .sort((a, b) => a.roomSeq - b.roomSeq)
    .flatMap((event) => {
      const status = event.workflowStatus;
      const changed =
        status &&
        event.previousWorkflowStatus &&
        status !== event.previousWorkflowStatus;
      const assignment = [
        "task.assigned",
        "task.unassigned",
        "task.reassigned",
        "task.claimed",
      ].includes(event.type);
      const title =
        event.type === "task.created"
          ? "创建任务"
          : assignment
            ? "变更负责人"
            : event.type === "task.cancelled"
              ? "关闭任务"
              : event.type === "task.reopened"
                ? "重新打开任务"
                : event.type === "task.amended"
                  ? "更新任务"
                  : changed
                    ? "变更状态"
                    : undefined;
      return title
        ? [
            { event, title, status: assignment ? undefined : status },
            ...(assignment && changed
              ? [{ event, title: "变更状态", status }]
              : []),
          ]
        : [];
    });
}

export function taskAmendmentDetails(changes: Entry["changes"]) {
  return Object.entries(changes ?? {})
    .flatMap(([field, change]) =>
      change
        ? [
            `${field === "title" ? "标题" : "描述"}：${change.from ?? "—"} → ${change.to ?? "—"}`,
          ]
        : [],
    )
    .join(" · ");
}
