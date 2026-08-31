import type { RuntimeTrajectoryRecord } from "@rah-os/protocol";

/** Earlier paging keeps the requested older edge. Live mode reads a fresh tail. */
export function mergeTrajectoryWindow(
  current: readonly RuntimeTrajectoryRecord[],
  incoming: readonly RuntimeTrajectoryRecord[],
): RuntimeTrajectoryRecord[] {
  const records = new Map(
    [...current, ...incoming].map((entry) => [entry.activityId, entry]),
  );
  return [...records.values()]
    .sort((left, right) => left.serverSequence - right.serverSequence)
    .slice(0, 500);
}
