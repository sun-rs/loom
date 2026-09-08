import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  runLocalCoreCommand,
  runLocalCoreService,
} from "../src/local-core-cli-dispatch.ts";

test("installed Core stops and propagates a terminal restart failure without waiting for a signal", async () => {
  let stopped = 0;
  let release!: () => void;
  const shutdown = new Promise<void>((resolve) => {
    release = resolve;
  });
  const service = runLocalCoreService({
    environment: {
      RAH_WEB_STATIC_DIRECTORY: "/tmp/fixture-web",
      RAH_DATA_HOME: "/tmp/fixture-home",
    },
    async startWorkbench() {
      return {
        descriptor: {
          defaultRoomId: "fixture",
          persistent: true,
          runtimes: [],
          stateDirectory: "/tmp/fixture-home/state",
          webOrigin: "http://127.0.0.1:4173",
          workspaceCwd: "/tmp",
          workspaceId: "fixture",
        },
        failed: Promise.resolve(new Error("successor startup failed")),
        async stop() {
          stopped += 1;
        },
      };
    },
    waitForShutdown: () => shutdown,
  });
  const result = service.then(
    () => "clean shutdown",
    (error: Error) => error.message,
  );
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(
      await Promise.race([result, Promise.resolve("still waiting")]),
      "successor startup failed",
    );
    assert.equal(stopped, 1);
  } finally {
    release();
    await result;
  }
});

test("a terminal service failure closes the installed entry process with a nonzero result", () => {
  const module = new URL("../src/local-core-cli-dispatch.ts", import.meta.url)
    .href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
    import { runLocalCoreService } from ${JSON.stringify(module)};
    await runLocalCoreService({
      environment: { RAH_WEB_STATIC_DIRECTORY: "/tmp/fixture-web", RAH_DATA_HOME: "/tmp/fixture-home" },
      async startWorkbench() {
        return {
          descriptor: { defaultRoomId: "fixture", persistent: true, runtimes: [], stateDirectory: "/tmp/fixture-home/state", webOrigin: "http://127.0.0.1:4173", workspaceCwd: "/tmp", workspaceId: "fixture" },
          failed: Promise.resolve(new Error("fixture-terminal-startup-failure")),
          async stop() { process.stdout.write("fixture-owner-stopped\\n"); }
        };
      },
      waitForShutdown: () => new Promise(() => {})
    });
  `,
    ],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1);
  assert.match(child.stdout, /fixture-owner-stopped/);
  assert.match(child.stderr, /fixture-terminal-startup-failure/);
});

test("self-contained Core dispatch keeps service and embedded child roles exact", async () => {
  const calls: string[] = [];
  const output: string[] = [];
  assert.equal(
    await runLocalCoreCommand(
      ["__claude-stream-json-driver", "--executable", "/tmp/claude"],
      {
        runRuntimeDriver: async (kind, arguments_) => {
          calls.push(`driver:${kind}:${arguments_.join(" ")}`);
          return 0;
        },
      },
    ),
    0,
  );
  assert.equal(
    await runLocalCoreCommand(
      ["install", "--mode", "loopback", "--workspace", "/tmp/workspace"],
      {
        runProductOperator: async (arguments_) => {
          calls.push(`operator:${arguments_.join(" ")}`);
          return {
            availableRuntimes: [],
            healthOrigin: "http://127.0.0.1:4173",
            installationKind: "activated",
            kind: "install",
            logDirectory: "/tmp/logs",
            plistPath: "/tmp/core.plist",
            product: {
              directory: "/tmp/product",
              nodeCarrierVersion: "v26.8.1",
              version: "0.1.0",
            },
            serviceTarget: "gui/501/dev.rah-os.local-core",
            sourceBound: false,
            workbenchHome: "/tmp/home",
            workspace: "/tmp/workspace",
          };
        },
        writeOutput: (value) => output.push(value),
      },
    ),
    0,
  );
  assert.equal(
    await runLocalCoreCommand(["__local-core-service"], {
      runService: async () => {
        calls.push("service");
        return 0;
      },
    }),
    0,
  );
  assert.equal(
    await runLocalCoreCommand(["__runtime-process-supervisor"], {
      runProcessSupervisor: async () => {
        calls.push("supervisor");
        return 0;
      },
    }),
    0,
  );
  assert.equal(
    await runLocalCoreCommand(["__worker-cli", "worker", "help"], {
      runWorkerCli: async (arguments_) => {
        calls.push(`worker:${arguments_.join(" ")}`);
        return 0;
      },
    }),
    0,
  );
  assert.equal(
    await runLocalCoreCommand(
      ["__codex-app-server-driver", "--executable", "/tmp/codex"],
      {
        runRuntimeDriver: async (kind, arguments_) => {
          calls.push(`driver:${kind}:${arguments_.join(" ")}`);
          return 0;
        },
      },
    ),
    0,
  );
  assert.equal(
    await runLocalCoreCommand(
      ["__kimi-acp-driver", "--executable", "/tmp/kimi"],
      {
        runRuntimeDriver: async (kind, arguments_) => {
          calls.push(`driver:${kind}:${arguments_.join(" ")}`);
          return 0;
        },
      },
    ),
    0,
  );
  assert.equal(
    await runLocalCoreCommand(
      ["__opencode-server-driver", "--executable", "/tmp/opencode"],
      {
        runRuntimeDriver: async (kind, arguments_) => {
          calls.push(`driver:${kind}:${arguments_.join(" ")}`);
          return 0;
        },
      },
    ),
    0,
  );
  assert.deepEqual(calls, [
    "driver:claude-stream-json:--executable /tmp/claude",
    "operator:--mode loopback --workspace /tmp/workspace",
    "service",
    "supervisor",
    "worker:worker help",
    "driver:codex-app-server:--executable /tmp/codex",
    "driver:kimi-acp:--executable /tmp/kimi",
    "driver:opencode-server:--executable /tmp/opencode",
  ]);
  assert.match(output[0]!, /^RAH_MACOS_LOCAL_CORE_INSTALL /u);
});

test("self-contained Core dispatch rejects ambiguous command shapes", async () => {
  await assert.rejects(runLocalCoreCommand([]), /usage: rah-os-core/u);
  await assert.rejects(
    runLocalCoreCommand(["__local-core-service", "extra"]),
    /usage: rah-os-core/u,
  );
  await assert.rejects(
    runLocalCoreCommand(["__runtime-process-supervisor", "extra"]),
    /usage: rah-os-core/u,
  );
});
