import process from "node:process";

import {
  NodeResidentRunnerControlPlane,
  ResidentRunnerStateStore,
  ResidentRunnerSupervisor,
} from "../../src/index.ts";

const controlDirectory = process.env.RAH_TEST_RESIDENT_CONTROL_DIRECTORY;
const cwd = process.env.RAH_TEST_RESIDENT_CWD;
const runnerFixture = process.env.RAH_TEST_RESIDENT_FIXTURE;
const socketDirectory = process.env.RAH_TEST_RESIDENT_SOCKET_DIRECTORY;
const statePath = process.env.RAH_TEST_RESIDENT_STATE_PATH;

if (
  !controlDirectory ||
  !cwd ||
  !runnerFixture ||
  !socketDirectory ||
  !statePath
) {
  throw new Error("disposable resident runner host environment is incomplete");
}

const controlPlane = new NodeResidentRunnerControlPlane({
  args: [runnerFixture],
  command: process.execPath,
  controlDirectory,
  cwd,
  env: { RAH_RESIDENT_FIXTURE_MODE: "connected" },
  pollIntervalMs: 5,
  socketDirectory,
  terminationGraceMs: 25,
});
const supervisor = new ResidentRunnerSupervisor({
  launcher: controlPlane,
  recoveryProbe: controlPlane,
  store: new ResidentRunnerStateStore({ statePath }),
});
await supervisor.initialize();
await supervisor.reconcile(true);
const deadline = Date.now() + 5_000;
while ((await supervisor.flush()).lifecycle !== "running") {
  if (Date.now() >= deadline) {
    throw new Error("resident runner did not become connected");
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
}

await new Promise((resolve, reject) => {
  process.stdout.write(`${JSON.stringify(supervisor.state())}\n`, (error) => {
    if (error) reject(error);
    else resolve();
  });
});
// The parent test sends SIGKILL here: no reconcile(false), stop or cleanup.
await new Promise(() => undefined);
