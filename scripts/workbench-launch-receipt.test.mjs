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

// The incumbent 2026-09-16 entry set: Tailnet plus one explicitly trusted LAN
// address. A restart must reproduce it exactly, from the receipt, never from a
// rescan of the host's interfaces.
test("a Tailnet receipt carries its trusted LAN entries into an empty shell restart", () => {
  const mode = {
    kind: "tailnet",
    bindHost: "100.101.107.87",
    additionalBindHosts: ["127.0.0.1", "192.168.1.86"],
    port: 4173,
  };
  const env = restartNetworkEnvironment(
    { PATH: "/bin" },
    { schemaVersion: 1, pid: 42, mode },
    42,
  );
  assert.equal(env.RAH_TAILNET_HOST, "100.101.107.87");
  assert.equal(env.RAH_TRUSTED_LAN_HOSTS, "192.168.1.86");
  const restarted = workbenchLaunchMode(env, "/tmp/rah", {
    en0: [{ family: "IPv4", internal: false, address: "10.55.0.9" }],
  });
  assert.deepEqual(restarted, mode);
  assert.deepEqual(
    [restarted.bindHost, ...restarted.additionalBindHosts]
      .map((host) => `${host}:${String(restarted.port)}`)
      .sort(),
    ["100.101.107.87:4173", "127.0.0.1:4173", "192.168.1.86:4173"],
  );
});
test("a Tailnet-only receipt does not reintroduce LAN entries on restart", () => {
  const env = restartNetworkEnvironment(
    { RAH_TRUSTED_LAN_HOSTS: "10.0.0.5" },
    {
      schemaVersion: 1,
      pid: 42,
      mode: { kind: "tailnet", bindHost: "100.64.0.2", port: 4173 },
    },
    42,
  );
  assert.equal(env.RAH_TRUSTED_LAN_HOSTS, undefined);
  assert.deepEqual(
    workbenchLaunchMode(env, "/tmp/rah", {
      en0: [{ family: "IPv4", internal: false, address: "192.168.1.86" }],
    }).additionalBindHosts,
    ["127.0.0.1"],
  );
});
test("a corrupted network entry list fails closed instead of narrowing or widening", () => {
  for (const additionalBindHosts of [
    ["127.0.0.1", "203.0.113.5"],
    ["127.0.0.1", "192.168.1.999"],
    ["127.0.0.1", "0.0.0.0"],
    ["127.0.0.1", "192.168.1.86", "192.168.1.86"],
    "192.168.1.86",
  ]) {
    assert.throws(
      () =>
        restartNetworkEnvironment(
          {},
          {
            schemaVersion: 1,
            pid: 42,
            mode: {
              kind: "tailnet",
              bindHost: "100.101.107.87",
              additionalBindHosts,
              port: 4173,
            },
          },
          42,
        ),
      /trusted LAN/iu,
      `expected ${JSON.stringify(additionalBindHosts)} to fail closed`,
    );
  }
});
test("writing a receipt refuses a network entry set the launcher could not reproduce", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rah-launch-receipt-"));
  try {
    await assert.rejects(
      writeLaunchReceipt(
        dir,
        {
          kind: "tailnet",
          bindHost: "100.101.107.87",
          additionalBindHosts: ["127.0.0.1", "203.0.113.5"],
          port: 4173,
        },
        42,
      ),
      /trusted LAN/iu,
    );
    assert.equal(await readLaunchReceipt(dir), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("a receipt whose Tailnet entry left the CGNAT range fails closed", () => {
  for (const bindHost of [
    "192.168.1.86",
    "127.0.0.1",
    "203.0.113.5",
    "0.0.0.0",
  ])
    assert.throws(
      () =>
        restartNetworkEnvironment(
          {},
          {
            schemaVersion: 1,
            pid: 42,
            mode: { kind: "tailnet", bindHost, port: 4173 },
          },
          42,
        ),
      /Tailnet/u,
      `expected receipt bindHost ${bindHost} to fail closed`,
    );
});

test("restart preserves explicit supplemental HTTPS and clears inherited additions", () => {
  const env = {
    RAH_TAILNET_HOST: "100.64.0.2",
    RAH_TRUSTED_LAN_HOSTS: "192.168.1.86",
    RAH_WEB_PORT: "4176",
    RAH_ADDITIONAL_HTTPS_ORIGIN: "https://192.168.1.86:4178",
  };
  const mode = workbenchLaunchMode(env, "/tmp/rah");
  const restored = restartNetworkEnvironment(
    {},
    { schemaVersion: 1, pid: 42, mode },
    42,
  );
  assert.equal(
    restored.RAH_ADDITIONAL_HTTPS_ORIGIN,
    env.RAH_ADDITIONAL_HTTPS_ORIGIN,
  );
  assert.deepEqual(workbenchLaunchMode(restored, "/tmp/rah"), mode);
  assert.equal(
    restartNetworkEnvironment(
      env,
      { schemaVersion: 1, pid: 42, mode: { kind: "loopback", port: 4176 } },
      42,
    ).RAH_ADDITIONAL_HTTPS_ORIGIN,
    undefined,
  );
});
