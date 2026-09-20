import type { RuntimeTrajectoryRecord } from "@rah-os/protocol";

/** Raft live activity window: stable identities, ascending order, latest 500. */
export function mergeTrajectoryWindow(
  current: readonly RuntimeTrajectoryRecord[],
  incoming: readonly RuntimeTrajectoryRecord[],
): RuntimeTrajectoryRecord[] {
  const records = new Map(
    [...current, ...incoming].map((entry) => [entry.activityId, entry]),
  );
  return [...records.values()]
    .sort((left, right) => left.serverSequence - right.serverSequence)
    .slice(-500);
}
