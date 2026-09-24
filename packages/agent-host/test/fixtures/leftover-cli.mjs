// Fake Provider CLI for S2-0 leftover-process tests. It leaves descendants
// that escape the run's process group, the way `setsid`/`nohup`/double-fork
// tools and dev servers do, then exits. Never a real Provider.
import { spawn } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";

const reportPath = process.env.RAH_LEFTOVER_REPORT;
if (reportPath === undefined) throw new Error("RAH_LEFTOVER_REPORT missing");

const server = `
const net = require("node:net");
const s = net.createServer(() => {});
s.listen(0, "127.0.0.1", () => {
  process.stdout.write(JSON.stringify({
    pid: process.pid,
    port: s.address().port,
    runtimeId: process.env.LOOM_RUNTIME_ID ?? null,
    runId: process.env.LOOM_RUN_ID ?? null,
  }) + "\\n");
});
setInterval(() => {}, 1000);
`;
const stubborn = `
process.on("SIGTERM", () => {});
process.on("SIGHUP", () => {});
process.stdout.write(JSON.stringify({ pid: process.pid }) + "\\n");
setInterval(() => {}, 1000);
`;

function launchDetached(source) {
  // detached: true calls setsid(): a new session and process group, so the
  // run's process-group kill does not reach it.
  const child = spawn(process.execPath, ["-e", source], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  child.unref();
  return new Promise((resolve, reject) => {
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      child.stdout.destroy();
      resolve(JSON.parse(buffer.slice(0, newline)));
    });
    child.once("error", reject);
  });
}

const [listener, detached] = await Promise.all([
  launchDetached(server),
  launchDetached(stubborn),
]);
const temporary = `${reportPath}.${process.pid}.tmp`;
writeFileSync(temporary, JSON.stringify({ detached, listener }));
renameSync(temporary, reportPath);
process.exit(Number(process.env.RAH_LEFTOVER_EXIT ?? "0"));
