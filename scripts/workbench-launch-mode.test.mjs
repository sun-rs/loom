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

test("Tailnet mode retains loopback and discovers only private LAN IPv4 bindings", () => {
  const mode = workbenchLaunchMode(
    { RAH_TAILNET_HOST: "100.101.107.87" },
    "/tmp/rah",
    {
      en0: [{ family: "IPv4", internal: false, address: "192.168.1.86" }],
      utun: [{ family: "IPv4", internal: false, address: "198.18.0.1" }],
    },
  );
  assert.deepEqual(mode.additionalBindHosts, ["127.0.0.1", "192.168.1.86"]);
});
