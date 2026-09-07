import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  assertRahOsRepositoryIdentity,
  assertRepositoryIdentity,
} from "./repository-identity.mjs";

const repositoryDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");

test("accepts the real rah_os repository identity", async () => {
  const identity = await assertRahOsRepositoryIdentity({
    commandCwd: repositoryDirectory,
  });

  assert.equal(identity.packageName, "rah-os");
  assert.equal(identity.repositoryDirectory, identity.commandCwd);
  assert.equal(identity.repositoryDirectory, identity.gitTopLevel);
  assert.match(identity.head, /^[a-f0-9]{40,64}$/u);
});

test("rejects a wrong cwd before a caller can perform its side effect", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-wrong-cwd-"));
  let mutated = false;
  try {
    await assert.rejects(
      assertRahOsRepositoryIdentity({ commandCwd: directory }),
      /command cwd belongs to another repository/u,
    );
    assert.equal(mutated, false);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("rejects a repository with the wrong root package before a write", async () => {
  const directory = temporaryRepository("not-rah-os");
  const output = join(directory, "side-effect.txt");
  try {
    await assert.rejects(
      assertRepositoryIdentity({
        commandCwd: directory,
        expectedPackageName: "rah-os",
        repositoryDirectory: directory,
        requiredOwnerPaths: [],
      }),
      /root package name/u,
    );
    assert.throws(() => readFileSync(output), /ENOENT/u);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("CLI refuses an absolute rah_os script launched from another cwd", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-cli-cwd-"));
  try {
    const result = spawnSync(
      process.execPath,
      [join(repositoryDirectory, "scripts", "repository-identity.mjs")],
      { cwd: directory, encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /command cwd belongs to another repository/u);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

function temporaryRepository(packageName) {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-identity-repo-"));
  writeFileSync(
    join(directory, "package.json"),
    `${JSON.stringify({ name: packageName })}\n`,
  );
  mkdirSync(join(directory, "scripts"));
  execFileSync("git", ["init", "--quiet"], { cwd: directory });
  execFileSync("git", ["config", "user.email", "identity@test.invalid"], {
    cwd: directory,
  });
  execFileSync("git", ["config", "user.name", "Identity Test"], {
    cwd: directory,
  });
  execFileSync("git", ["add", "package.json"], { cwd: directory });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], {
    cwd: directory,
  });
  return directory;
}
