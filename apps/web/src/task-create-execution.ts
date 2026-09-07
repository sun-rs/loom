import type { RahClient } from "@rah-os/client-sdk";
import type { ClientTaskCreateRequest } from "@rah-os/protocol";

type TaskCreateSequenceSession = {
  syncUntilCurrent(options?: { maxPages?: number }): Promise<{
    caughtUp: boolean;
    state: { latestRoomSeq: number };
  }>;
};

export type TaskCreateCommandLedger = {
  readonly size: number;
  discard(clientIds: readonly string[]): void;
  get(clientId: string): ClientTaskCreateRequest | undefined;
  remove(clientId: string): void;
  remember(clientId: string, command: ClientTaskCreateRequest): void;
};

export function createTaskCreateCommandLedger(): TaskCreateCommandLedger {
  const commands = new Map<string, ClientTaskCreateRequest>();
  return {
    get size() {
      return commands.size;
    },
    discard(clientIds) {
      for (const clientId of clientIds) commands.delete(clientId);
    },
    get(clientId) {
      return commands.get(clientId);
    },
    remove(clientId) {
      commands.delete(clientId);
    },
    remember(clientId, command) {
      commands.set(clientId, command);
    },
  };
}

export async function submitTaskCreateRows(input: {
  assigneeId?: string;
  client: RahClient;
  collaboratorIds: readonly string[];
  dependencyTaskIds: readonly string[];
  ledger: TaskCreateCommandLedger;
  onAccepted: (clientId: string) => void;
  reviewerIds: readonly string[];
  roomId: string;
  session: TaskCreateSequenceSession;
  titles: readonly { clientId: string; title: string }[];
}): Promise<void> {
  for (const task of input.titles) {
    let command = input.ledger.get(task.clientId);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (command === undefined) {
        const caughtUp = await input.session.syncUntilCurrent({ maxPages: 10 });
        if (!caughtUp.caughtUp) {
          throw new Error(
            "Room mutation requires a complete causal projection",
          );
        }
        command = {
          ...(input.assigneeId === undefined
            ? {}
            : { assigneeId: input.assigneeId }),
          basedOnRoomSeq: caughtUp.state.latestRoomSeq,
          collaboratorIds: [...input.collaboratorIds],
          dependencyTaskIds: [...input.dependencyTaskIds],
          idempotencyKey: `web-board-task-${task.clientId}`,
          reviewerIds: [...input.reviewerIds],
          roomId: input.roomId,
          title: task.title,
        };
        input.ledger.remember(task.clientId, command);
      }
      try {
        await input.client.request("task.create", command);
        input.ledger.remove(task.clientId);
        input.onAccepted(task.clientId);
        break;
      } catch (failure) {
        if (!isStaleContextFailure(failure) || attempt === 3) throw failure;
        // A stale_context response proves this exact idempotency key did not
        // commit: Kernel replay is checked before the freshness fence. Only
        // then may the causal guard be regenerated; unknown failures retain
        // the byte-for-byte command for an exact replay.
        input.ledger.remove(task.clientId);
        command = undefined;
      }
    }
  }
}

function isStaleContextFailure(
  failure: unknown,
): failure is { code: "stale_context"; status: 409 } {
  return (
    failure !== null &&
    typeof failure === "object" &&
    "code" in failure &&
    failure.code === "stale_context" &&
    "status" in failure &&
    failure.status === 409
  );
}
