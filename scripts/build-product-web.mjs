import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function assertOfficialFrontendReady(adoption) {
  if (adoption.productConnected !== true) {
    throw new Error(
      "Official frontend is not connected to Loom yet; product installation is unavailable. Existing installed assets and the backend console remain available.",
    );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = resolve(import.meta.dirname, "..");
  assertOfficialFrontendReady(
    JSON.parse(
      readFileSync(resolve(root, "frontends/raft/adoption.json"), "utf8"),
    ),
  );
  execFileSync(
    process.execPath,
    [resolve(root, "frontends/raft/scripts/prepare-ui-source.mjs")],
    { stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    [
      resolve(root, "frontends/raft/node_modules/vite/bin/vite.js"),
      "build",
      "--config",
      "../../loom/vite.config.ts",
    ],
    { cwd: resolve(root, "frontends/raft/packages/web"), stdio: "inherit" },
  );
}
