import { TaskLoadingList, TaskLoadingRow, Skeleton } from "raft-ui";
/** One native loading surface for both module and initial query admission. */
export default function TaskLoading() {
  return (
    <TaskLoadingList role="status" aria-label="正在读取任务">
      {[0, 1, 2, 3, 4].map((id) => (
        <TaskLoadingRow key={id}>
          <Skeleton variant="line" className="w-1/2" />
          <Skeleton variant="line" className="w-3/4" />
        </TaskLoadingRow>
      ))}
    </TaskLoadingList>
  );
}
