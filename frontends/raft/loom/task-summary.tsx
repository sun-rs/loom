import { useContext, type ComponentProps } from "react";
import { TaskStatusBadge } from "raft-ui";
import { TaskActions } from "./TaskProperties";
import type { Task } from "../packages/web/src/store/taskStore";
import { toRuiTaskStatus } from "../packages/web/src/components/task/taskStatusUi";
export function useTaskSummaryIdentity(task: Task) {
  const { members } = useContext(TaskActions);
  const member = members?.find((m) => m.principalId === task.claimedById);
  return {
    identity: member
      ? { displayName: member.displayName ?? member.handle }
      : null,
    viewerId: undefined,
  };
}
export function TaskSummaryStatus({
  status,
  ...props
}: Omit<ComponentProps<typeof TaskStatusBadge>, "status"> & {
  status: Task["status"];
}) {
  return <TaskStatusBadge {...props} status={toRuiTaskStatus(status)} />;
}
