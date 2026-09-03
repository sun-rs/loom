export { taskAttentionLabel, taskStatusPresentation } from "@rah-os/ui-web";

export type TaskFilterSelection = {
  assigneeId?: string | null;
  creatorId?: string;
};

export function taskMatchesFilters(
  task: { assigneeId?: string | undefined; creatorId: string },
  filters: TaskFilterSelection,
): boolean {
  if (filters.creatorId !== undefined && task.creatorId !== filters.creatorId) {
    return false;
  }
  if (filters.assigneeId === null) return task.assigneeId === undefined;
  if (
    filters.assigneeId !== undefined &&
    task.assigneeId !== filters.assigneeId
  ) {
    return false;
  }
  return true;
}
