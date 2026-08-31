import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";

const config = JSON.parse(readFileSync(3, "utf8"));
await writeFile(
  config.resultPath,
  JSON.stringify({
    args: process.argv.slice(2),
    inheritedSecret: process.env.RAH_K_SLOT_PARENT_SECRET !== undefined,
    processId: process.pid,
    secret: config.secret,
  }),
  { mode: 0o600 },
);
await new Promise((resolve) => setTimeout(resolve, 1_000));
