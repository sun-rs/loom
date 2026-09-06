import { readFileSync } from "node:fs";
import path from "node:path";

import { RoomLedger } from "../packages/runtime-daemon/src/room/index.ts";

const dataRoot = process.argv[2];
const fixturePath = process.argv[3];
if (!dataRoot || !path.isAbsolute(dataRoot) || !fixturePath || !path.isAbsolute(fixturePath)) {
  throw new Error(
    "usage: room_browser_emit_notification.ts <absolute-data-root> <absolute-fixture-path>",
  );
}

const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  roomId: string;
  ownerId: string;
  workerId: string;
};
const probeLabel = process.argv[4]?.trim() || "default";
const ledger = new RoomLedger(path.join(dataRoot, "room", "room.db"));
try {
  const posted = ledger.postMessage(fixture.workerId, {
    roomId: fixture.roomId,
    body: `Browser notification pipeline probe: ${probeLabel}`,
    mentionedPrincipalIds: [fixture.ownerId],
    idempotencyKey: `browser-notification-probe:${probeLabel}:${Date.now()}`,
  });
  process.stdout.write(`${JSON.stringify({
    eventId: posted.event.eventId,
    roomSeq: posted.event.roomSeq,
    messageId: posted.value.messageId,
  })}\n`);
} finally {
  ledger.close();
}
