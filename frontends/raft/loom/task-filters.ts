import type { GlobalTasksRequest } from "@rah-os/protocol";
export type TaskFilterKey = "taskRoom" | "taskCreator" | "taskAssignee";
export function changeTaskFilter(
  params: URLSearchParams,
  key: TaskFilterKey,
  values: string[],
) {
  const next = new URLSearchParams(params);
  next.delete(key);
  for (const value of new Set(values)) if (value) next.append(key, value);
  return next;
}
export function taskFilterRequest(
  params: URLSearchParams,
  channelId?: string,
): Pick<
  GlobalTasksRequest,
  "roomIds" | "creatorIds" | "assigneeIds" | "unassigned"
> {
  const rooms = channelId ? [channelId] : params.getAll("taskRoom");
  const creators = params.getAll("taskCreator");
  const selected = params.getAll("taskAssignee");
  const assignees = selected.filter((id) => id !== "unassigned");
  return {
    ...(rooms.length ? { roomIds: rooms } : {}),
    ...(creators.length ? { creatorIds: creators } : {}),
    ...(assignees.length ? { assigneeIds: assignees } : {}),
    ...(selected.includes("unassigned") ? { unassigned: true } : {}),
  };
}
