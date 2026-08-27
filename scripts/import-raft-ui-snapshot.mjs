import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(
  process.argv[2] ?? join(repositoryRoot, "..", "raft-ui"),
);
const packageRoot = join(repositoryRoot, "packages", "raft-ui-snapshot");
const snapshotRoot = join(packageRoot, "reference");

const rootFiles = [
  "AUDIT.md",
  "README.md",
  "activity.css",
  "activity.html",
  "activity.js",
  "admin.css",
  "admin.html",
  "admin.js",
  "agents.css",
  "agents.html",
  "agents.js",
  "app.js",
  "billing.css",
  "billing.html",
  "billing.js",
  "channel-extras.css",
  "channel-extras.js",
  "computers.css",
  "computers.html",
  "computers.js",
  "coverage-matrix.json",
  "index.html",
  "members.css",
  "members.html",
  "members.js",
  "mobile.css",
  "mobile.html",
  "mobile.js",
  "search.css",
  "search.html",
  "search.js",
  "settings.css",
  "settings.html",
  "settings.js",
  "slack.css",
  "slack.html",
  "slack.js",
  "state-matrix.md",
  "styles.css",
  "tasks.css",
  "tasks.html",
  "tasks.js",
  "tokens.brutal.css",
  "tokens.md",
];

function filesIn(directory, extensions) {
  return readdirSync(join(sourceRoot, directory), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(directory, entry.name))
    .filter((path) => extensions.some((extension) => path.endsWith(extension)));
}

const files = [
  ...rootFiles,
  ...filesIn("generated", [".css", ".json", ".svg"]),
  ...filesIn("protocol", [".json", ".md"]),
  ...filesIn("ui", [".css", ".js", ".md"]),
  "vendor/raft/index-EQxYM8hQ.css",
  "vendor/raft/manifest.json",
  "vendor/raft/official-fonts.css",
  ...filesIn("vendor/raft/fonts", [".woff2"]),
].sort();

if (
  !readFileSync(join(sourceRoot, "README.md"), "utf8").includes(
    "Raft UI reference",
  )
) {
  throw new Error(
    `${sourceRoot} is not the expected raft-ui reference repository`,
  );
}
if (!snapshotRoot.startsWith(`${repositoryRoot}${sep}`)) {
  throw new Error("snapshot target escaped the repository");
}

rmSync(snapshotRoot, { force: true, recursive: true });
mkdirSync(snapshotRoot, { recursive: true });

const entries = files.map((path) => {
  const sourcePath = join(sourceRoot, path);
  const stat = lstatSync(sourcePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`snapshot source must be a regular file: ${path}`);
  }
  const targetPath = join(snapshotRoot, path);
  if (relative(snapshotRoot, targetPath).startsWith("..")) {
    throw new Error(`snapshot path escaped its target: ${path}`);
  }
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
  const content = readFileSync(sourcePath);
  return {
    bytes: content.byteLength,
    path,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
});

const gitHead = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: sourceRoot,
  encoding: "utf8",
}).trim();
const dirty =
  execFileSync("git", ["status", "--porcelain=v1"], {
    cwd: sourceRoot,
    encoding: "utf8",
  }).trim().length > 0;

writeFileSync(
  join(packageRoot, "snapshot-manifest.json"),
  `${JSON.stringify(
    {
      files: entries,
      schemaVersion: 1,
      source: { dirty, gitHead, repository: "raft-ui" },
    },
    null,
    2,
  )}\n`,
);

process.stdout.write(
  `Imported ${String(entries.length)} Raft UI reference files from ${sourceRoot}\n`,
);
