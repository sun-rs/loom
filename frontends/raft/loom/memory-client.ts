// Human presentation transport only. Kernel owns memory and revision checks.
import type { RahClient } from "@rah-os/client-sdk";
import type { MemoryEntry, MemoryMutationResponse } from "@rah-os/protocol";
import {
  WriteIntentSlot,
  type IntentOutcome,
} from "@rah-os/client-core/write-intent";
export class MemoryClient {
  readonly client: RahClient;
  readonly writes = new WriteIntentSlot();
  constructor(client: RahClient) {
    this.client = client;
  }
  async list(
    channelIds: string[],
    query: string,
    state: string,
    signal?: AbortSignal,
  ) {
    const entries: MemoryEntry[] = [];
    const failed: string[] = [];
    let truncated = false;
    // Bounded concurrency, no eager bodies or historical revisions.
    for (let i = 0; i < channelIds.length; i += 4) {
      const results = await Promise.allSettled(
        channelIds.slice(i, i + 4).map(async (channelId) =>
          query.trim()
            ? this.client.request(
                "memory.search",
                { channelId, query: query.trim(), limit: 50 },
                { signal },
              )
            : this.client.request(
                "memory.list",
                {
                  channelId,
                  includeInvalidated: true,
                  includeDeleted: state === "deleted" || state === "all",
                  limit: 200,
                },
                { signal },
              ),
        ),
      );
      results.forEach((result, index) => {
        if (result.status === "rejected") failed.push(channelIds[i + index]!);
        else {
          entries.push(...result.value.entries);
          truncated ||= result.value.truncated;
        }
      });
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    }
    return {
      entries: entries
        .filter((e) => state === "all" || e.state === state)
        .sort(
          (a, b) =>
            Number(b.pinned) - Number(a.pinned) ||
            b.updatedAt.localeCompare(a.updatedAt),
        ),
      failed,
      truncated,
    };
  }
  update(
    entry: MemoryEntry,
    description: string,
    body: string,
    onSettled: (outcome: IntentOutcome<MemoryMutationResponse>) => void,
  ) {
    return this.writes.submitRevisioned({
      action: "memory-update",
      payload: {
        entryId: entry.entryId,
        expectedRevision: entry.revision,
        description,
        body,
      },
      send: (payload, idempotencyKey) =>
        this.client.request("memory.update", { ...payload, idempotencyKey }),
      onSettled,
    });
  }
  change(
    kind: "pin" | "unpin" | "invalidate" | "restore" | "delete",
    entry: MemoryEntry,
    reason: string,
    onSettled: (outcome: IntentOutcome<MemoryMutationResponse>) => void,
  ) {
    const payload = {
      entryId: entry.entryId,
      expectedRevision: entry.revision,
    };
    return this.writes.submitRevisioned({
      action: "memory-change",
      payload,
      send: (p, idempotencyKey) => {
        if (kind === "pin" || kind === "unpin")
          return this.client.request("memory.pin", {
            ...p,
            pinned: kind === "pin",
            idempotencyKey,
          });
        if (kind === "restore")
          return this.client.request("memory.restore", {
            ...p,
            idempotencyKey,
          });
        return this.client.request(
          kind === "delete" ? "memory.delete" : "memory.invalidate",
          { ...p, reason, idempotencyKey },
        );
      },
      onSettled,
    });
  }
}
