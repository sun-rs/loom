import process from "node:process";

import { GenericProcessAdapter } from "../../src/generic-process-adapter.ts";

const fakeCliPath = process.env.RAH_TEST_FAKE_CLI_PATH;
const pidFile = process.env.RAH_TEST_PID_FILE;
const supervisorDirectory = process.env.RAH_TEST_SUPERVISOR_DIRECTORY;

if (!fakeCliPath || !pidFile || !supervisorDirectory) {
  throw new Error("disposable process host environment is incomplete");
}

const adapter = new GenericProcessAdapter({
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

const run = await adapter.start(
  {
    activationId: "activation-disposable-host",
    consumerId: "disposable-host:runtime",
    fromSeq: 1,
    hostId: "disposable-host",
    participantId: "agent-disposable-host",
    reason: "mention",
    roomId: "room-disposable-host",
    runAttemptId: "run-disposable-host",
    toSeq: 1,
  },
  { registerPrepared: async () => {} },
);

const deadline = Date.now() + 2_000;
while (!adapter.diagnostics(run).stderr.includes("child-ready")) {
  if (Date.now() >= deadline) {
    throw new Error("supervised Fake CLI did not become ready");
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
}

await new Promise((resolve, reject) => {
  process.stdout.write(`${JSON.stringify(run)}\n`, (error) => {
    if (error) reject(error);
    else resolve();
  });
});

// Model a hard AgentHost/daemon loss. No adapter cancellation or cleanup runs.
process.exit(0);
