import { execFileSync } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepositoryDirectory = resolve(dirname(scriptPath), "..");
const DEFAULT_OWNER_PATHS = [
  "packages/core",
  "packages/kernel",
  "packages/agent-host",
];

export async function assertRahOsRepositoryIdentity(options = {}) {
  return assertRepositoryIdentity({
    commandCwd: options.commandCwd ?? process.cwd(),
    expectedPackageName: "rah-os",
    repositoryDirectory:
      options.repositoryDirectory ?? defaultRepositoryDirectory,
    requiredOwnerPaths: options.requiredOwnerPaths ?? DEFAULT_OWNER_PATHS,
  });
}

export async function assertRepositoryIdentity({
  commandCwd,
  expectedPackageName,
  repositoryDirectory,
  requiredOwnerPaths,
}) {
  const expectedRoot = await realpath(repositoryDirectory);
  const actualCwd = await realpath(commandCwd);
  if (actualCwd !== expectedRoot) {
    throw new Error(
      `command cwd belongs to another repository: expected ${expectedRoot}, received ${actualCwd}`,
    );
  }

  const gitTopLevel = await realpath(
    runGit(expectedRoot, ["rev-parse", "--show-toplevel"]),
  );
  if (gitTopLevel !== expectedRoot) {
    throw new Error(
      `Git top-level belongs to another repository: expected ${expectedRoot}, received ${gitTopLevel}`,
    );
  }

  const packageDocument = JSON.parse(
    await readFile(join(expectedRoot, "package.json"), "utf8"),
  );
  if (packageDocument.name !== expectedPackageName) {
    throw new Error(
      `unexpected root package name: expected ${expectedPackageName}, received ${String(packageDocument.name)}`,
    );
  }

  for (const relativePath of requiredOwnerPaths) {
    const metadata = await stat(join(expectedRoot, relativePath));
    if (!metadata.isDirectory()) {
      throw new Error(
        `required owner path is not a directory: ${relativePath}`,
      );
    }
  }

  return Object.freeze({
    commandCwd: actualCwd,
    gitTopLevel,
    head: runGit(expectedRoot, ["rev-parse", "HEAD"]),
    packageName: packageDocument.name,
    repositoryDirectory: expectedRoot,
  });
}

function runGit(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 5_000,
  }).trim();
}

if (resolve(process.argv[1] ?? "") === resolve(scriptPath)) {
  try {
    const identity = await assertRahOsRepositoryIdentity();
    process.stdout.write(`${JSON.stringify(identity)}\n`);
  } catch (error) {
    process.stderr.write(
      `rah_os repository identity check failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
