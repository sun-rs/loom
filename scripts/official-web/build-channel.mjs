import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
// Builds the bounded channel integration slice for isolated acceptance only.
// Product installation still requires adoption.productConnected.
const root = resolve(import.meta.dirname, "../..");
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
