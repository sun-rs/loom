import assert from "node:assert/strict";
import test from "node:test";

import { runNodeKCarrierComputerCommand } from "../src/index.ts";

test("self-contained Computer command dispatches only exact internal modes", async () => {
  const calls: string[] = [];
  const runtime = {
    runProcessSupervisor: async () => {
      calls.push("process-supervisor");
      return 0 as const;
    },
    runRuntimeDriver: async (
      kind:
        | "claude-stream-json"
        | "codex-app-server"
        | "kimi-acp"
        | "opencode-server",
      arguments_: readonly string[],
    ) => {
      calls.push(`runtime-driver:${kind}:${arguments_.join("|")}`);
      return 0 as const;
    },
    runService: async (arguments_: readonly string[]) => {
      calls.push(`service:${arguments_.join("|")}`);
      return 0 as const;
    },
    runSupervisor: async (arguments_: readonly string[]) => {
      calls.push(`supervisor:${arguments_.join("|")}`);
      return 0 as const;
    },
    runUpgrade: async (input: {
      configurationFd: number;
      requestPath: string;
    }) => {
      calls.push(`upgrade:${input.configurationFd}:${input.requestPath}`);
      return { kind: "no_request" as const };
    },
    runWorkerCli: async (arguments_: readonly string[]) => {
      calls.push(`worker-cli:${arguments_.join("|")}`);
      return 1 as const;
    },
  };
  assert.equal(
    await runNodeKCarrierComputerCommand(
      ["__claude-stream-json-driver", "--executable", "/tmp/claude"],
      runtime,
    ),
    0,
  );
  assert.equal(
    await runNodeKCarrierComputerCommand(
      ["__computer-supervisor", "--config-path", "/tmp/supervisor.json"],
      runtime,
    ),
    0,
  );
  assert.equal(
    await runNodeKCarrierComputerCommand(
      ["__computer-service", "--config-fd=3", "--supervisor-fd=4"],
      runtime,
    ),
    0,
  );
  assert.equal(
    await runNodeKCarrierComputerCommand(
      ["__computer-upgrade", "/tmp/request.json", "--config-fd=3"],
      runtime,
    ),
    0,
  );
  assert.equal(
    await runNodeKCarrierComputerCommand(
      ["__runtime-process-supervisor"],
      runtime,
    ),
    0,
  );
  assert.equal(
    await runNodeKCarrierComputerCommand(
      ["__worker-cli", "worker", "sync", "--after-seq", "3"],
      runtime,
    ),
    1,
  );
  assert.equal(
    await runNodeKCarrierComputerCommand(
      ["__codex-app-server-driver", "--executable", "/tmp/codex"],
      runtime,
    ),
    0,
  );
  assert.equal(
    await runNodeKCarrierComputerCommand(
      ["__kimi-acp-driver", "--executable", "/tmp/kimi"],
      runtime,
    ),
    0,
  );
  assert.equal(
    await runNodeKCarrierComputerCommand(
      ["__opencode-server-driver", "--executable", "/tmp/opencode"],
      runtime,
    ),
    0,
  );
  assert.deepEqual(calls, [
    "runtime-driver:claude-stream-json:--executable|/tmp/claude",
    "supervisor:__computer-supervisor|--config-path|/tmp/supervisor.json",
    "service:__computer-service|--config-fd=3|--supervisor-fd=4",
    "upgrade:3:/tmp/request.json",
    "process-supervisor",
    "worker-cli:worker|sync|--after-seq|3",
    "runtime-driver:codex-app-server:--executable|/tmp/codex",
    "runtime-driver:kimi-acp:--executable|/tmp/kimi",
    "runtime-driver:opencode-server:--executable|/tmp/opencode",
  ]);
  await assert.rejects(
    runNodeKCarrierComputerCommand(
      ["__runtime-process-supervisor", "unexpected"],
      runtime,
    ),
    /usage/u,
  );
  await assert.rejects(
    runNodeKCarrierComputerCommand(
      ["__computer-upgrade", "/tmp/request.json", "--config-fd=4"],
      runtime,
    ),
    /usage/u,
  );
  await assert.rejects(
    runNodeKCarrierComputerCommand(["--help"], runtime),
    /usage/u,
  );
});
