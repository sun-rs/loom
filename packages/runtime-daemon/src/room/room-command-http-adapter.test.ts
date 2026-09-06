import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { RoomCommandHttpAdapter } from "./room-command-http-adapter";
import { RoomCommandService } from "./room-command-service";
import { RoomLedger } from "./room-ledger";

test("Room command adapter derives the Human actor and returns bounded receipts", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-command-"));
  const ledger = new RoomLedger(path.join(root, "room.db"), {
    now: () => new Date("2026-09-06T08:00:00.000Z"),
  });
  try {
    const adapter = new RoomCommandHttpAdapter(new RoomCommandService(ledger));
    const created = adapter.execute({ kind: "local" }, "create_room", {
      roomId: "room-one",
      workspaceKey: "workspace-main",
      kind: "channel",
      slug: "general",
      name: "General",
      idempotencyKey: "create-room-one",
    });
    assert.equal(created.status, 200);
    assert.deepEqual(JSON.parse(created.body.toString("utf8")), {
      ok: true,
      data: {
        operation: "create_room",
        roomId: "room-one",
        aggregateId: "room-one",
        roomSeq: 1,
        deduplicated: false,
      },
    });
    const replay = adapter.execute({ kind: "local" }, "create_room", {
      roomId: "room-one",
      workspaceKey: "workspace-main",
      kind: "channel",
      slug: "general",
      name: "General",
      idempotencyKey: "create-room-one",
    });
    assert.equal(JSON.parse(replay.body.toString("utf8")).data.deduplicated, true);
    assert.equal(created.headers["cache-control"], "no-store");
  } finally {
    ledger.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Room command adapter rejects actor injection and unauthenticated commands", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-command-auth-"));
  const ledger = new RoomLedger(path.join(root, "room.db"));
  try {
    const adapter = new RoomCommandHttpAdapter(new RoomCommandService(ledger));
    const injected = adapter.execute({ kind: "local" }, "create_room", {
      actorId: "forged-agent",
      workspaceKey: "workspace-main",
      kind: "channel",
      slug: "general",
      name: "General",
      idempotencyKey: "injected-actor",
    });
    assert.equal(injected.status, 400);
    assert.equal(JSON.parse(injected.body.toString("utf8")).error.code, "invalid_argument");
    const unauthenticated = adapter.execute(null, "create_room", {});
    assert.equal(unauthenticated.status, 401);
  } finally {
    ledger.close();
    rmSync(root, { recursive: true, force: true });
  }
});
