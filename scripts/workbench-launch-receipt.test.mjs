import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workbenchLaunchMode } from "./workbench-launch-mode.mjs";
import {
  restartNetworkEnvironment,
  writeLaunchReceipt,
  readLaunchReceipt,
} from "./workbench-launch-receipt.mjs";

test("a restart from a plain shell preserves the running Tailnet and LAN discovery mode", () => {
  const mode = { kind: "tailnet", bindHost: "100.64.0.2", port: 4173 };
  const saved = { schemaVersion: 1, pid: 42, mode };
  const env = restartNetworkEnvironment(
    { PATH: "/bin", RAH_LAN_ORIGIN: "https://wrong.example" },
    saved,
    42,
  );
  assert.equal(env.RAH_LAN_ORIGIN, undefined);
  assert.equal(env.PATH, "/bin");
  assert.deepEqual(workbenchLaunchMode(env, "/tmp/rah", {}), {
    ...mode,
    additionalBindHosts: ["127.0.0.1"],
  });
});
test("LAN HTTPS retains origin, binding and certificate paths without storing keys or credentials", () => {
  const mode = {
    kind: "lan",
    bindHost: "192.168.1.2",
    publicOrigin: "https://rah.example",
    tlsDirectory: "/tmp/tls",
    certificatePath: "/tmp/cert.pem",
    privateKeyPath: "/tmp/key.pem",
  };
  const env = restartNetworkEnvironment(
    { RAH_TAILNET_HOST: "100.64.0.9" },
    { schemaVersion: 1, pid: 42, mode },
    42,
  );
  assert.equal(env.RAH_TAILNET_HOST, undefined);
  assert.equal(env.RAH_LAN_ORIGIN, mode.publicOrigin);
  assert.equal(env.RAH_LAN_KEY_PATH, mode.privateKeyPath);
  assert.equal(env.RAH_LAN_BIND_HOST, mode.bindHost);
});
test("missing, stale or invalid receipts fail before a restart can silently change access", () => {
  assert.throws(() => restartNetworkEnvironment({}, undefined, 42), /receipt/i);
  assert.throws(
    () =>
      restartNetworkEnvironment(
        {},
        { schemaVersion: 1, pid: 41, mode: { kind: "loopback", port: 4173 } },
        42,
      ),
    /incumbent/i,
  );
  assert.throws(
    () =>
      restartNetworkEnvironment(
        {},
        { schemaVersion: 1, pid: 42, mode: { kind: "unknown" } },
        42,
      ),
    /mode/i,
  );
});
test("explicit loopback receipt clears inherited remote launch variables", () => {
  const env = restartNetworkEnvironment(
    { RAH_TAILNET_HOST: "100.64.0.9", RAH_LAN_ORIGIN: "https://old.example" },
    { schemaVersion: 1, pid: 42, mode: { kind: "loopback", port: 4173 } },
    42,
  );
  assert.equal(env.RAH_TAILNET_HOST, undefined);
  assert.equal(env.RAH_LAN_ORIGIN, undefined);
  assert.equal(env.RAH_WEB_PORT, "4173");
});
test("successful startup receipt is private, round-trips and is replaced with the new PID", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rah-launch-receipt-"));
  try {
    assert.equal(await readLaunchReceipt(dir), undefined);
    await writeLaunchReceipt(
      dir,
      { kind: "tailnet", bindHost: "100.64.0.2", port: 4173 },
      42,
    );
    assert.equal(
      (await stat(join(dir, "workbench-launch.json"))).mode & 0o777,
      0o600,
    );
    await writeLaunchReceipt(dir, { kind: "loopback", port: 4173 }, 43);
    const receipt = await readLaunchReceipt(dir);
    assert.equal(receipt.pid, 43);
    assert.equal(receipt.mode.kind, "loopback");
    assert.ok(
      !(await readFile(join(dir, "workbench-launch.json"), "utf8")).includes(
        "TOKEN",
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
