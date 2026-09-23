import { readFileSync } from "node:fs";
import { DaemonApplication } from "../../packages/daemon/src/index.ts";
const app = new DaemonApplication({
  config: JSON.parse(readFileSync(process.argv[2], "utf8")),
});
const stop = new AbortController();
process.on("SIGTERM", () => stop.abort("gate-drain"));
const running = app.run({ signal: stop.signal });
const ready = setInterval(() => {
  if (app.health().state === "online" && app.clientOrigin()) {
    clearInterval(ready);
    console.log(
      "GATE_READY " +
        JSON.stringify({ pid: process.pid, origin: app.clientOrigin() }),
    );
  }
}, 100);
try {
  await running;
} finally {
  clearInterval(ready);
}
