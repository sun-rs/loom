import assert from "node:assert/strict";
import test from "node:test";

import { runLocalCoreCommand } from "../src/local-core-cli-dispatch.ts";

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
