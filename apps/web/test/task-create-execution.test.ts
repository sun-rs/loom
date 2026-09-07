import assert from "node:assert/strict";
import test from "node:test";

import type { RahClient } from "@rah-os/client-sdk";

import {
  createTaskCreateCommandLedger,
  submitTaskCreateRows,
} from "../src/task-create-execution.ts";

test("partial Task creation retries only the unconfirmed row with its exact original command", async () => {
  const commands: unknown[] = [];
  const accepted: string[] = [];
  const sequences = [10, 11, 99];
  let failSecondRow = true;
  const client = {
    request: async (_operation: string, input: unknown) => {
      commands.push(structuredClone(input));
      if (failSecondRow && (input as { title: string }).title === "second") {
        failSecondRow = false;
        throw new Error("response lost");
      }
      return { deduplicated: false };
    },
  } as unknown as RahClient;
  const session = {
    syncUntilCurrent: async () => ({
      caughtUp: true,
      state: { latestRoomSeq: sequences.shift() ?? 99 },
    }),
  };
  const ledger = createTaskCreateCommandLedger();
  const shared = {
    assigneeId: "agent-a",
    collaboratorIds: ["agent-b"],
    dependencyTaskIds: ["task-old"],
    reviewerIds: ["agent-c"],
    roomId: "room",
  } as const;

  await assert.rejects(
    submitTaskCreateRows({
      client,
      ledger,
      onAccepted: (clientId) => accepted.push(clientId),
      session,
      ...shared,
      titles: [
        { clientId: "row-one", title: "first" },
        { clientId: "row-two", title: "second" },
      ],
    }),
    /response lost/u,
  );
  assert.deepEqual(accepted, ["row-one"]);
  const failedCommand = commands[1];

  await submitTaskCreateRows({
    client,
    ledger,
    onAccepted: (clientId) => accepted.push(clientId),
    session,
    // A caller-side display drift must not rewrite an ambiguous command.
    ...shared,
    assigneeId: "agent-d",
    titles: [{ clientId: "row-two", title: "changed display" }],
  });
  assert.deepEqual(accepted, ["row-one", "row-two"]);
  assert.deepEqual(commands[2], failedCommand);
  assert.equal((commands[2] as { basedOnRoomSeq: number }).basedOnRoomSeq, 11);
  assert.equal(sequences.length, 1, "a retained command must not resync");
});

test("discarding a Task create dialog removes every retained ambiguous command", async () => {
  const ledger = createTaskCreateCommandLedger();
  const client = {
    request: async () => {
      throw new Error("offline");
    },
  } as unknown as RahClient;
  await assert.rejects(
    submitTaskCreateRows({
      client,
      ledger,
      onAccepted: () => {},
      roomId: "room",
      session: {
        syncUntilCurrent: async () => ({
          caughtUp: true,
          state: { latestRoomSeq: 4 },
        }),
      },
      titles: [{ clientId: "row", title: "task" }],
      collaboratorIds: [],
      dependencyTaskIds: [],
      reviewerIds: [],
    }),
    /offline/u,
  );
  assert.equal(ledger.size, 1);
  ledger.discard(["row"]);
  assert.equal(ledger.size, 0);
});

test("an accepted Task whose response is lost is replayed exactly once through Kernel idempotency", async () => {
  const acceptedByServer = new Map<string, unknown>();
  const requests: unknown[] = [];
  let loseFirstReceipt = true;
  const client = {
    request: async (_operation: string, input: unknown) => {
      const request = structuredClone(input) as { idempotencyKey: string };
      requests.push(request);
      const duplicate = acceptedByServer.has(request.idempotencyKey);
      if (!duplicate) acceptedByServer.set(request.idempotencyKey, request);
      if (loseFirstReceipt) {
        loseFirstReceipt = false;
        throw new Error("connection closed after commit");
      }
      return { deduplicated: duplicate };
    },
  } as unknown as RahClient;
  const ledger = createTaskCreateCommandLedger();
  const input = {
    client,
    ledger,
    onAccepted: () => {},
    roomId: "room",
    session: {
      syncUntilCurrent: async () => ({
        caughtUp: true,
        state: { latestRoomSeq: 41 },
      }),
    },
    titles: [{ clientId: "accepted-row", title: "committed once" }],
    collaboratorIds: ["agent-b"],
    dependencyTaskIds: ["task-old"],
    reviewerIds: ["agent-c"],
  } as const;

  await assert.rejects(submitTaskCreateRows(input), /after commit/u);
  await submitTaskCreateRows(input);
  assert.equal(acceptedByServer.size, 1);
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(ledger.size, 0);
});

test("only an explicit stale_context rejection regenerates the causal sequence", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const sequences = [7, 9];
  const client = {
    request: async (_operation: string, input: unknown) => {
      requests.push(structuredClone(input) as Record<string, unknown>);
      if (requests.length === 1) throw { code: "stale_context", status: 409 };
      return { deduplicated: false };
    },
  } as unknown as RahClient;
  await submitTaskCreateRows({
    client,
    ledger: createTaskCreateCommandLedger(),
    onAccepted: () => {},
    roomId: "room",
    session: {
      syncUntilCurrent: async () => ({
        caughtUp: true,
        state: { latestRoomSeq: sequences.shift() ?? 99 },
      }),
    },
    titles: [{ clientId: "stale-row", title: "same business command" }],
    collaboratorIds: ["agent-b"],
    dependencyTaskIds: ["task-old"],
    reviewerIds: ["agent-c"],
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.basedOnRoomSeq, 7);
  assert.equal(requests[1]?.basedOnRoomSeq, 9);
  assert.equal(requests[0]?.idempotencyKey, requests[1]?.idempotencyKey);
  const withoutSequence = requests.map(
    ({ basedOnRoomSeq: _ignored, ...rest }) => rest,
  );
  assert.deepEqual(withoutSequence[0], withoutSequence[1]);
});
