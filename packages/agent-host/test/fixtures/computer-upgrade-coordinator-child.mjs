import { readFileSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";

const requestPath = process.argv[2];
if (typeof requestPath !== "string") process.exit(2);
const configuration = process.argv.includes("--config-fd=3")
  ? JSON.parse(readFileSync(3, "utf8"))
  : {};

const envelope = JSON.parse(await readFile(requestPath, "utf8"));
await new Promise((resolve) => setTimeout(resolve, 80));
const observationPath = `${requestPath}.observed`;
const stagingPath = `${observationPath}.${String(process.pid)}.tmp`;
await writeFile(
  stagingPath,
  `${JSON.stringify({
    configurationSecret: configuration.fixtureSecret,
    inheritedSecret: process.env.RAH_UPGRADE_TEST_PARENT_SECRET !== undefined,
    operationId: envelope.request.operationId,
    parentProcessId: process.ppid,
    processId: process.pid,
  })}\n`,
  { mode: 0o600 },
);
await rename(stagingPath, observationPath);
await new Promise((resolve) => setTimeout(resolve, 1_000));
