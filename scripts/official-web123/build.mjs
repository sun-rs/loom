import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  realpathSync,
  symlinkSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../.."),
  source = resolve(root, "frontends/raft/upstream/web-1.21.23"),
  adapter = resolve(root, "frontends/raft/adapter123");
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, ["--test", "scripts/official-web123/source.test.mjs"]);
if (process.argv.includes("--install"))
  run(
    "npx",
    [
      "--yes",
      "pnpm@12.11.2",
      "--filter",
      "@botiverse/raft-web...",
      "install",
      "--frozen-lockfile",
    ],
    source,
  );
const dependencies = source + "/packages/web/node_modules";
if (!existsSync(dependencies + "/vite/package.json"))
  throw Error(
    "First run with --install to install the original frozen dependency lock.",
  );
const link = adapter + "/node_modules";
if (!existsSync(link))
  symlinkSync("../upstream/web-1.21.23/packages/web/node_modules", link, "dir");
if (
  !lstatSync(link).isSymbolicLink() ||
  realpathSync(link) !== realpathSync(dependencies)
)
  throw Error(
    "Adapter must use exactly the original dependency tree; refusing to overwrite another directory.",
  );
if (process.argv.includes("--reference"))
  run(
    "npx",
    ["--yes", "pnpm@12.11.2", "--filter", "@botiverse/raft-web", "build"],
    source,
  );
run(dependencies + "/.bin/tsc", [
  "--noEmit",
  "--project",
  adapter + "/tsconfig.json",
]);
run(dependencies + "/.bin/vite", [
  "build",
  "--config",
  adapter + "/vite.config.ts",
]);
const graph = JSON.parse(
  readFileSync(
    resolve(root, "frontends/raft/dist-native123/native-boundary.json"),
    "utf8",
  ),
);
if (
  graph.source !== "db5e399" ||
  graph.ui !== "0.7.0" ||
  graph.legacyUiModules.length
)
  throw Error("Native source boundary did not pass");
console.log(
  "Candidate only: original Web1.21.23 / UI0.7.0. This command does not change the deployed product.",
);
