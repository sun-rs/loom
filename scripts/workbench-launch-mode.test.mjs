import assert from "node:assert/strict";
import test from "node:test";
import { workbenchLaunchMode } from "./workbench-launch-mode.mjs";
test("default keeps local access", () =>
  assert.deepEqual(workbenchLaunchMode({}, "/tmp/rah"), {
    kind: "loopback",
    port: 4173,
  }));
test("explicit LAN uses authenticated HTTPS edge configuration", () =>
  assert.deepEqual(
    workbenchLaunchMode(
      { RAH_LAN_ORIGIN: "https://192.168.1.86:4173" },
      "/tmp/rah",
    ),
    {
      kind: "lan",
      bindHost: "0.0.0.0",
      publicOrigin: "https://192.168.1.86:4173",
      tlsDirectory: "/tmp/rah/tls",
    },
  ));
test("explicit Tailnet HTTP binds only its address without pairing", () =>
  assert.deepEqual(
    workbenchLaunchMode({ RAH_TAILNET_HOST: "100.101.107.87" }, "/tmp/rah", {}),
    {
      kind: "tailnet",
      bindHost: "100.101.107.87",
      additionalBindHosts: ["127.0.0.1"],
      port: 4173,
    },
  ));

test("Tailnet alone authorizes no ordinary LAN interface", () => {
  const interfaces = {
    en0: [{ family: "IPv4", internal: false, address: "192.168.1.86" }],
    en1: [{ family: "IPv4", internal: false, address: "10.7.0.4" }],
    utun: [{ family: "IPv4", internal: false, address: "198.18.0.1" }],
  };
  assert.deepEqual(
    workbenchLaunchMode(
      { RAH_TAILNET_HOST: "100.101.107.87" },
      "/tmp/rah",
      interfaces,
    ),
    {
      kind: "tailnet",
      bindHost: "100.101.107.87",
      additionalBindHosts: ["127.0.0.1"],
      port: 4173,
    },
  );
});

test("a new or removed interface never changes the authorized set", () => {
  const environment = {
    RAH_TAILNET_HOST: "100.101.107.87",
    RAH_TRUSTED_LAN_HOSTS: "192.168.1.86",
  };
  const withNic = workbenchLaunchMode(environment, "/tmp/rah", {
    en0: [{ family: "IPv4", internal: false, address: "192.168.1.86" }],
    en1: [{ family: "IPv4", internal: false, address: "10.9.9.9" }],
  });
  const withoutNic = workbenchLaunchMode(environment, "/tmp/rah", {});
  assert.deepEqual(withNic.additionalBindHosts, ["127.0.0.1", "192.168.1.86"]);
  assert.deepEqual(withoutNic, withNic);
});

test("explicit trusted LAN hosts bind exactly the configured addresses", () => {
  assert.deepEqual(
    workbenchLaunchMode(
      {
        RAH_TAILNET_HOST: "100.101.107.87",
        RAH_TRUSTED_LAN_HOSTS: " 192.168.1.86 , 10.2.3.4 ",
      },
      "/tmp/rah",
      {},
    ).additionalBindHosts,
    ["127.0.0.1", "192.168.1.86", "10.2.3.4"],
  );
});

test("duplicate, public, malformed or loopback trusted LAN hosts are refused", () => {
  for (const value of [
    "192.168.1.86,192.168.1.86",
    "203.0.113.5",
    "100.101.107.88",
    "192.168.1.999",
    "rah.local",
    "127.0.0.1",
    "192.168.1.86,",
    "",
  ]) {
    assert.throws(
      () =>
        workbenchLaunchMode(
          {
            RAH_TAILNET_HOST: "100.101.107.87",
            RAH_TRUSTED_LAN_HOSTS: value,
          },
          "/tmp/rah",
          {},
        ),
      /RAH_TRUSTED_LAN_HOSTS/u,
      `expected ${JSON.stringify(value)} to be refused`,
    );
  }
});

test("trusted LAN hosts are never derived outside an explicit Tailnet entry", () => {
  assert.throws(
    () =>
      workbenchLaunchMode(
        { RAH_TRUSTED_LAN_HOSTS: "192.168.1.86" },
        "/tmp/rah",
        {},
      ),
    /RAH_TAILNET_HOST/u,
  );
  assert.throws(
    () =>
      workbenchLaunchMode(
        {
          RAH_LAN_ORIGIN: "https://192.168.1.86:4173",
          RAH_TRUSTED_LAN_HOSTS: "192.168.1.86",
        },
        "/tmp/rah",
        {},
      ),
    /RAH_TAILNET_HOST/u,
  );
});

test("the Tailnet variable never accepts an ordinary LAN, loopback or public address", () => {
  for (const value of [
    "192.168.1.86",
    "10.0.0.5",
    "172.16.0.1",
    "127.0.0.1",
    "0.0.0.0",
    "203.0.113.5",
    "100.63.255.255",
    "100.128.0.1",
    "100.64.1.999",
    "fd7a:115c:a1e0::1",
    "rah.example",
    "100.101.107.87:4173",
  ]) {
    assert.throws(
      () => workbenchLaunchMode({ RAH_TAILNET_HOST: value }, "/tmp/rah"),
      (error) =>
        /RAH_TAILNET_HOST/u.test(error.message) &&
        /RAH_TRUSTED_LAN_HOSTS/u.test(error.message),
      `expected ${JSON.stringify(value)} to be refused with a LAN pointer`,
    );
  }
});

test("the Tailnet variable accepts the CGNAT range it owns", () => {
  for (const value of ["100.64.0.1", "100.101.107.87", "100.127.255.255"]) {
    assert.equal(
      workbenchLaunchMode({ RAH_TAILNET_HOST: value }, "/tmp/rah").bindHost,
      value,
    );
  }
});
