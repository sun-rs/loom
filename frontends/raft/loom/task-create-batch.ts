import type { ChannelTaskClient } from "./channel-task-client.ts";
/** Form submission only: every row uses the channel's existing single write slot. */
export async function createTaskBatch(
  facade: ChannelTaskClient,
  titles: readonly string[],
  accepted: (count: number) => void,
  uncertain: () => void,
) {
  for (let index = 0; index < titles.length; index++) {
    await new Promise<void>((resolve, reject) => {
      void facade
        .create(titles[index]!, (outcome) => {
          if (outcome.kind === "ok") resolve();
          else if (outcome.kind === "rejected") reject(outcome.error);
          else if (outcome.kind === "unknown") uncertain();
          // Unknown deliberately leaves this promise unresolved. Explicit retry
          // invokes the SAME slot callback; no later row is sent before proof.
        })
        .then((outcome) => {
          if (outcome.kind === "busy") reject(Error("频道仍有未决操作"));
        })
        .catch(reject);
    });
    accepted(index + 1);
  }
}
