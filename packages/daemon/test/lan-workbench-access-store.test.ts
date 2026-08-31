import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LanWorkbenchAccessStore } from "../src/lan-workbench-access-store.ts";

test("LAN access persists only credential digests and revokes every device session", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-lan-access-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const path = join(stateDirectory, "lan-access.json");
  let now = Date.parse("2026-08-28T08:00:00.000Z");

  try {
    const store = new LanWorkbenchAccessStore({
      clock: () => now,
      path,
    });
    const invite = store.issuePairingCode({ ttlMs: 10 * 60_000 });
    assert.match(invite.code, /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){2}$/u);
    assert.equal(store.exchangePairingCode("WRNG-WRNG-WRNG", "iPhone"), null);

    const paired = store.exchangePairingCode(invite.code, "Sun 的 iPhone");
    assert.ok(paired);
    assert.equal(paired.device.displayName, "Sun 的 iPhone");
    assert.equal(store.exchangePairingCode(invite.code, "replay"), null);
    assert.equal(
      store.authenticateSession(paired.sessionToken)?.deviceId,
      paired.device.deviceId,
    );
    assert.deepEqual(store.listDevices(), [paired.device]);

    const serialized = readFileSync(path, "utf8");
    assert.doesNotMatch(serialized, new RegExp(invite.code, "u"));
    assert.doesNotMatch(serialized, new RegExp(paired.sessionToken, "u"));
    assert.equal(lstatSync(path).mode & 0o077, 0);
    assert.equal(lstatSync(stateDirectory).mode & 0o077, 0);

    const reopened = new LanWorkbenchAccessStore({
      clock: () => now,
      path,
    });
    assert.equal(
      reopened.authenticateSession(paired.sessionToken)?.deviceId,
      paired.device.deviceId,
    );
    assert.equal(reopened.revokeDevice(paired.device.deviceId), true);
    assert.equal(reopened.authenticateSession(paired.sessionToken), null);
    assert.equal(reopened.revokeDevice(paired.device.deviceId), false);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("LAN pairing and browser sessions expire against the injected clock", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-lan-expiry-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  let now = Date.parse("2026-08-28T09:00:00.000Z");

  try {
    const store = new LanWorkbenchAccessStore({
      clock: () => now,
      path: join(stateDirectory, "lan-access.json"),
      sessionTtlMs: 1_000,
    });
    const expiredInvite = store.issuePairingCode({ ttlMs: 500 });
    now += 501;
    assert.equal(
      store.exchangePairingCode(expiredInvite.code, "expired invite"),
      null,
    );

    const activeInvite = store.issuePairingCode({ ttlMs: 500 });
    const paired = store.exchangePairingCode(activeInvite.code, "MacBook");
    assert.ok(paired);
    now += 1_001;
    assert.equal(store.authenticateSession(paired.sessionToken), null);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
