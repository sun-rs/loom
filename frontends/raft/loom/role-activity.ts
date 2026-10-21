import type { RahClient } from "@rah-os/client-sdk";
import { loadTrajectory } from "./run-details.ts";
export type ActivitySource = {
  agentId: string;
  instanceId: string;
  roomId: string;
  name: string;
};
export async function loadRoleActivity(
  client: RahClient,
  sources: ActivitySource[],
  signal?: AbortSignal,
  cursor?: string,
) {
  const rows: Array<{
    source: ActivitySource;
    record: Awaited<ReturnType<typeof loadTrajectory>>["activities"][number];
  }> = [];
  const failed: string[] = [];
  let nextCursor: string | undefined;
  // Bounded read concurrency; each instance keeps its existing authoritative API scope.
  for (let index = 0; index < sources.length; index += 4) {
    signal?.throwIfAborted();
    const group = sources.slice(index, index + 4);
    const results = await Promise.allSettled(
      group.map((source) =>
        loadTrajectory(
          client,
          {
            ...source,
            beforeActivityId: sources.length === 1 ? cursor : undefined,
          },
          signal,
        ),
      ),
    );
    results.forEach((result, i) => {
      const source = group[i]!;
      if (result.status === "fulfilled") {
        rows.push(
          ...result.value.activities.map((record) => ({ source, record })),
        );
        if (sources.length === 1) nextCursor = result.value.nextCursor;
      } else failed.push(source.name);
    });
  }
  signal?.throwIfAborted();
  rows.sort(
    (a, b) =>
      b.record.observedAt.localeCompare(a.record.observedAt) ||
      b.record.serverSequence - a.record.serverSequence ||
      a.record.activityId.localeCompare(b.record.activityId),
  );
  return { rows: rows.slice(0, 100), failed, nextCursor };
}
