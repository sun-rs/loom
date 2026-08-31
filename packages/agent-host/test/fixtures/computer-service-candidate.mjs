import { writeSync } from "node:fs";

import {
  createComputerServiceOwnershipProofHandler,
  UnixSocketInstanceLock,
} from "../../src/index.ts";

const config = JSON.parse(
  required(process.env.RAH_TEST_COMPUTER_SERVICE_CONFIG, "config"),
);
const controlToken = required(
  process.env.RAH_TEST_COMPUTER_SERVICE_TOKEN,
  "control token",
);
const lock = new UnixSocketInstanceLock({
  directory: config.directory,
  handleConnection: createComputerServiceOwnershipProofHandler({
    attestation: async () => ({
      buildVersion: config.buildVersion,
      candidateComputerInstanceId: config.candidateComputerInstanceId,
      candidateProcessId: process.pid,
      managedAttachmentIds: config.managedAttachmentIds,
      managedAttachmentIdentities: config.managedAttachmentIdentities,
      serviceGeneration: config.serviceGeneration,
      sourceProcessId: config.sourceProcessId,
    }),
    controlToken,
  }),
  hostId: config.hostId,
});

await lock.acquire();
writeSync(3, `${JSON.stringify({ processId: process.pid })}\n`);

await new Promise((resolve) => {
  process.once("SIGINT", resolve);
  process.once("SIGTERM", resolve);
});
await lock.release();

function required(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}
