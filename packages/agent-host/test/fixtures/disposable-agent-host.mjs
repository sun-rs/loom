import { writeFileSync } from "node:fs";

import { RoomKernel } from "@rah-os/kernel";

import { AgentHost, GenericProcessAdapter } from "../../src/index.ts";

const databasePath = process.env.RAH_TEST_DATABASE_PATH;
const fakeCliPath = process.env.RAH_TEST_FAKE_CLI_PATH;
const markerFile = process.env.RAH_TEST_MARKER_FILE;
const hostToken = process.env.RAH_TEST_HOST_TOKEN;
const pidFile = process.env.RAH_TEST_PID_FILE;
const supervisorDirectory = process.env.RAH_TEST_SUPERVISOR_DIRECTORY;

if (
  !databasePath ||
  !fakeCliPath ||
  !markerFile ||
  !hostToken ||
  !pidFile ||
  !supervisorDirectory
) {
  throw new Error("disposable AgentHost environment is incomplete");
}

const kernel = new RoomKernel({ databasePath });
kernel.initialize();
const authenticatedHost = kernel.authenticateHostAccessToken(hostToken);
const processRuntime = new GenericProcessAdapter({
  args: [fakeCliPath],
  command: process.execPath,
  cwd: supervisorDirectory,
  env: {
    RAH_FAKE_MODE: "ignore-term-with-child",
    RAH_FAKE_PID_FILE: pidFile,
  },
  supervisorDirectory,
  terminationGraceMs: 25,
});

const runtime = {
  cancel: (run) => processRuntime.cancel(run),
  probe: () => processRuntime.probe(),
  reap: (run) => processRuntime.reap(run),
  recover: (input) => processRuntime.recover(input),
  recoveryDrivers: processRuntime.recoveryDrivers,
  start: async (input, lifecycle) => {
    const run = await processRuntime.start(input, lifecycle);
    writeFileSync(markerFile, JSON.stringify(run));
    // Keep AgentHost exactly after target launch and before markRunAttemptRunning.
    await new Promise(() => {});
    return run;
  },
};

const host = new AgentHost({
  host: authenticatedHost,
  kernel,
  leaseMs: 100,
  runtime,
});

await host.reconcileOnce();
