import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DatabaseSync } from "node:sqlite";

import type { RoomEvent } from "@rah-os/protocol";

import { RoomKernel } from "../src/index.ts";
import { freshnessHoldContext } from "../src/freshness-hold-context.ts";

/**
 * The hold notice says "showing latest N of M" and calls what it dropped
 * "earlier". Selecting the oldest N made both statements false and hid the most
 * recent messages — the corrections and cancellations that decide whether a
 * retry is still correct.
 */
test("a capped freshness hold shows the newest messages, not the oldest", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-hold-window-"));
  try {
    const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "hold-window-human",
      kind: "human",
    });
    const actor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(actor, {
      name: "Hold window",
      slug: "hold-window",
    });
    const total = 25;
    for (let index = 1; index <= total; index += 1) {
      kernel.postMessage(actor, {
        body: `body ${index}`,
        idempotencyKey: `hold-window-${index}`,
        recipients: [],
        roomId: room.roomId,
      });
    }
    const database = new DatabaseSync(kernel.databasePath);
    const context = freshnessHoldContext(database, {
      basedOnRoomSeq: 0,
      eventFromRow: (row) =>
        ({
          payload: JSON.parse(String(row.payload_json)) as Record<
            string,
            unknown
          >,
          roomSeq: Number(row.room_seq),
        }) as unknown as RoomEvent,
      roomId: room.roomId,
      seenUpToSeq: 10_000,
    });

    assert.equal(context.newMessageCount, total);
    assert.equal(context.shownMessageCount, 20);
    assert.equal(context.omittedMessageCount, 5);
    const bodies = context.newerMessages.map(
      (event) => (event.payload as unknown as { body: string }).body,
    );
    assert.equal(bodies.at(-1), `body ${total}`, "the newest must be shown");
    assert.equal(bodies[0], `body ${total - 19}`, "the oldest are the omitted");
    assert.deepEqual(
      bodies,
      Array.from({ length: 20 }, (_, index) => `body ${total - 19 + index}`),
      "and they stay in ascending order for reading",
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
