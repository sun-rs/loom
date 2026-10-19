import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
/** Keep the official immutable-asset cache rules byte-exact; replace only payload/navigation binding. */
export function pushWorkerPlugin(): Plugin {
  const source = () => {
    const native = readFileSync(
      resolve(import.meta.dirname, "../packages/web/public/sw.js"),
      "utf8",
    );
    const end = native.indexOf("function isSameNotificationTarget(");
    if (end < 0) throw Error("Official push worker boundary changed");
    return (
      native.slice(0, end) +
      readFileSync(resolve(import.meta.dirname, "push-worker.js"), "utf8")
    );
  };
  return {
    name: "loom-push-worker",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "loom-push-sw.js",
        source: source(),
      });
    },
  };
}
