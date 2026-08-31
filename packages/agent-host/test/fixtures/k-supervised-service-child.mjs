import { closeSync, createReadStream, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";

if (
  !process.argv.includes("--config-fd=3") ||
  !process.argv.includes("--supervisor-fd=4")
) {
  process.exit(2);
}

const configuration = JSON.parse(readFileSync(3, "utf8"));
const lease = createReadStream("", { autoClose: false, fd: 4 });
let finish;
const stopped = new Promise((resolve) => {
  finish = resolve;
});
lease.once("end", finish);
lease.once("error", finish);
lease.resume();
process.once("SIGINT", finish);
process.once("SIGTERM", finish);
await writeFile(
  configuration.readyPath,
  `${JSON.stringify({
    configSecret: configuration.configSecret,
    inheritedSecret: process.env.RAH_SUPERVISOR_PARENT_SECRET !== undefined,
    processId: process.pid,
  })}\n`,
  { mode: 0o600 },
);
await stopped;
lease.destroy();
closeSync(4);
