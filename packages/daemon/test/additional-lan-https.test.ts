import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  additionalHttpsAddress,
  startAdditionalLanHttps,
  stopWorkbenchGateways,
} from "../src/additional-lan-https.ts";
import { LanWorkbenchGateway } from "../src/lan-workbench-gateway.ts";
import { runningWorkbench } from "../src/local-core-workbench.ts";

test("additional TLS edge explicitly selects trusted access and closes a failed startup", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "loom-additional-https-"));
  mkdirSync(join(home, "state"), { mode: 0o700 });
  mkdirSync(join(home, "dist"));
  writeFileSync(join(home, "dist", "index.html"), "fixture");
  let stops = 0;
  const refusal = new Error("fixture listener occupied");
  t.mock.method(
    LanWorkbenchGateway.prototype,
    "start",
    async function (this: LanWorkbenchGateway) {
      assert.throws(() => this.issuePairingCode(), /disabled/);
      throw refusal;
    },
  );
  t.mock.method(LanWorkbenchGateway.prototype, "stop", async () => {
    stops++;
  });
  try {
    await assert.rejects(
      startAdditionalLanHttps({
        origin: "https://192.168.1.86:4178",
        hosts: ["192.168.1.86"],
        httpPort: 4176,
        workbenchHome: home,
        accessToken: "fixture-token",
        daemonOrigin: "http://127.0.0.1:4444",
        staticDirectory: join(home, "dist"),
      }),
      refusal,
    );
    assert.equal(stops, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("Core failure closes both edges even if one cleanup rejects", async () => {
  let reject!: (error: Error) => void;
  const app = new Promise<void>((_, r) => {
    reject = r;
  });
  const closed: string[] = [];
  const running = runningWorkbench({
    applicationRun: app,
    shutdown: new AbortController(),
    descriptor: {
      defaultRoomId: "fixture",
      persistent: true,
      runtimes: [],
      stateDirectory: "/tmp/fixture",
      webOrigin: "http://127.0.0.1:4176",
      workspaceCwd: "/tmp/fixture",
      workspaceId: "fixture",
    },
    gateway: {
      stop: () =>
        stopWorkbenchGateways([
          {
            stop: async () => {
              closed.push("http");
              throw Error("fixture close failure");
            },
          },
          {
            stop: async () => {
              closed.push("https");
            },
          },
        ]),
    },
  });
  reject(Error("fixture Core failed"));
  assert.ok((await running.failed) instanceof AggregateError);
  assert.deepEqual(closed.sort(), ["http", "https"]);
  await running.stop();
  assert.equal(closed.length, 2);
});

test("TLS exposure cannot silently extend beyond a named private interface", () => {
  assert.deepEqual(
    additionalHttpsAddress("https://192.168.1.86:4178", ["192.168.1.86"], 4176),
    { hostname: "192.168.1.86", port: 4178 },
  );
  for (const origin of [
    "https://127.0.0.1:4178",
    "https://100.63.255.255:4178",
    "https://100.128.0.1:4178",
    "https://8.8.8.8:4178",
    "https://192.168.1.86:0",
  ])
    assert.throws(() =>
      additionalHttpsAddress(origin, [new URL(origin).hostname], 4176),
    );
});

test("explicit Tailnet TLS uses the existing exact-interface gateway and refuses pairing", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "loom-tailnet-https-"));
  mkdirSync(join(home, "dist"));
  writeFileSync(join(home, "dist", "index.html"), "fixture");
  const refusal = new Error("fixture Tailnet listener");
  let reached = false,
    stops = 0;
  t.mock.method(
    LanWorkbenchGateway.prototype,
    "start",
    async function (this: LanWorkbenchGateway) {
      reached = true;
      assert.throws(() => this.issuePairingCode(), /disabled/);
      throw refusal;
    },
  );
  t.mock.method(LanWorkbenchGateway.prototype, "stop", async () => {
    stops++;
  });
  try {
    assert.deepEqual(
      additionalHttpsAddress(
        "https://100.101.107.87:4178",
        ["100.101.107.87"],
        4176,
      ),
      { hostname: "100.101.107.87", port: 4178 },
    );
    assert.throws(() =>
      additionalHttpsAddress(
        "https://100.101.107.88:4178",
        ["100.101.107.87"],
        4176,
      ),
    );
    await assert.rejects(
      startAdditionalLanHttps({
        origin: "https://100.101.107.87:4178",
        hosts: ["100.101.107.87"],
        httpPort: 4176,
        workbenchHome: home,
        accessToken: "fixture",
        daemonOrigin: "http://127.0.0.1:4444",
        staticDirectory: join(home, "dist"),
      }),
      refusal,
    );
    assert.equal(reached, true);
    assert.equal(stops, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
