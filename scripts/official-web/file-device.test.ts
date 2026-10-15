import assert from "node:assert/strict";
import test from "node:test";
import { usesDaemonDevice } from "../../frontends/raft/loom/file-device.ts";

test("file-device preference is exact and does not mistake LAN names or lookalikes for loopback", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"])
    assert.equal(usesDaemonDevice(new URL("http://" + host + ":4176")), true);
  for (const host of [
    "192.168.1.8",
    "mac-studio.local",
    "localhost.example.com",
    "127.0.0.1.example.com",
  ])
    assert.equal(usesDaemonDevice(new URL("http://" + host)), false);
  assert.equal(
    usesDaemonDevice(new URL("http://localhost?fileDevice=remote")),
    false,
  );
  assert.equal(
    usesDaemonDevice(new URL("http://mac-studio.local?fileDevice=local")),
    true,
  );
  assert.equal(
    usesDaemonDevice(new URL("http://mac-studio.local?fileDevice=invalid")),
    false,
  );
});

test("explicit device preference survives same-tab navigation and blocked storage falls back safely", () => {
  const values = new Map<string, string>();
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  assert.equal(
    usesDaemonDevice(new URL("http://localhost?fileDevice=remote"), store),
    false,
  );
  assert.equal(
    usesDaemonDevice(new URL("http://localhost?room=another"), store),
    false,
  );
  assert.equal(
    usesDaemonDevice(new URL("http://localhost?fileDevice=local"), store),
    true,
  );
  const blocked = {
    getItem: () => {
      throw Error("blocked");
    },
    setItem: () => {
      throw Error("blocked");
    },
  };
  assert.equal(usesDaemonDevice(new URL("http://localhost"), blocked), true);
  assert.equal(
    usesDaemonDevice(new URL("http://localhost?fileDevice=remote"), blocked),
    false,
  );
});
