import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { RoomActorResolver } from "./room-actor";
import { RoomLedger } from "./room-ledger";

test("Room actor identity is daemon-owned and stable across clients and restarts", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-actor-"));
  const databasePath = path.join(root, "rooms.sqlite");
  try {
    const ledger = new RoomLedger(databasePath);
    const resolver = new RoomActorResolver(ledger);
    const local = resolver.resolve({ kind: "local" });
    const device = resolver.resolve({
      kind: "device",
      device: {
        id: "device-one",
        name: "Phone",
        createdAt: "2026-09-05T08:00:00.000Z",
        lastSeenAt: "2026-09-05T08:00:00.000Z",
      },
    });
    assert.equal(device.principalId, local.principalId);
    assert.equal(device.source, "trusted_device");
    assert.equal(device.deviceId, "device-one");
    assert.throws(() => resolver.resolve(null), /authenticated device/);
    ledger.close();

    const reopened = new RoomLedger(databasePath);
    try {
      assert.equal(
        new RoomActorResolver(reopened).resolve({ kind: "management" }).principalId,
        local.principalId,
      );
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Room actor provisioning survives a pre-existing owner handle", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-actor-collision-"));
  const databasePath = path.join(root, "rooms.sqlite");
  try {
    const ledger = new RoomLedger(databasePath, {
      createId: () => "principal-local-human",
    });
    ledger.provisionPrincipal({
      principalId: "service-owner",
      handle: "owner",
      kind: "service",
    });
    const actor = new RoomActorResolver(ledger).resolve({ kind: "local" });
    assert.equal(actor.principalId, "principal-local-human");
    ledger.close();

    const reopened = new RoomLedger(databasePath);
    try {
      assert.equal(
        new RoomActorResolver(reopened).resolve({ kind: "management" }).principalId,
        "principal-local-human",
      );
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
