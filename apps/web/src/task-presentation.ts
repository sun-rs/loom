export { taskAttentionLabel, taskStatusPresentation } from "@rah-os/ui-web";

export type TaskFilterSelection = {
  assigneeIds?: string[];
  creatorIds?: string[];
};

export function taskMatchesFilters(
  task: { assigneeId?: string | undefined; creatorId: string },
  filters: TaskFilterSelection,
): boolean {
  return (
    (!filters.creatorIds?.length ||
      filters.creatorIds.includes(task.creatorId)) &&
    (!filters.assigneeIds?.length ||
      filters.assigneeIds.includes(task.assigneeId ?? "unassigned"))
  );
}
