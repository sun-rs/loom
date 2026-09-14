import { normalizeDiscoveryParams } from "./raft-discovery-controls.ts";
import { threadRootSelectionFromSearch } from "@rah-os/ui-web";

export type GlobalTaskDetailSelection = {
  roomId: string;
  taskId: string;
  rootMessageId?: string | undefined;
};

export function globalTaskDetailFromSearch(
  search: string,
): GlobalTaskDetailSelection | undefined {
  const params = new URLSearchParams(search);
  const roomId = params.get("room"),
    taskId = params.get("task");
  if (params.get("target") !== "task" || !roomId || !taskId) return undefined;
  const rootMessageId = threadRootSelectionFromSearch(search, roomId);
  return {
    roomId,
    taskId,
    ...(rootMessageId === undefined ? {} : { rootMessageId }),
  };
}

export function closeGlobalTaskSearch(search: string): string {
  const params =
    new URLSearchParams(search).get("surface") === "tasks"
      ? normalizeDiscoveryParams(search, "tasks")
      : new URLSearchParams(search);
  for (const key of ["target", "task", "thread", "threadId", "message"])
    params.delete(key);
  return `?${params}`;
}
