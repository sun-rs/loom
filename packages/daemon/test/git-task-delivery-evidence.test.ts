import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { GitTaskDeliveryEvidenceCollector } from "../src/git-task-delivery-evidence.ts";

const execFile = promisify(execFileCallback);

test("Git delivery evidence freezes the activation base and the complete current patch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rah-os-delivery-git-"));
  try {
    await git(directory, "init");
    await git(directory, "config", "user.email", "test@rah.invalid");
    await git(directory, "config", "user.name", "RAH Test");
    await writeFile(join(directory, "tracked.txt"), "before\n");
    await git(directory, "add", "tracked.txt");
    await git(directory, "commit", "-m", "base");

    const collector = new GitTaskDeliveryEvidenceCollector();
    const baseline = await collector.captureBaseline({
      workspaceRoot: directory,
    });
    assert.equal(baseline.source, "git");
    if (baseline.source !== "git") return;

    await writeFile(join(directory, "tracked.txt"), "after\n");
    await mkdir(join(directory, "nested"));
    await writeFile(join(directory, "nested", "untracked.txt"), "new\n");
    const capture = await collector.captureSubmission({ baseline });

    assert.equal(capture.baseCommit, baseline.baseCommit);
    assert.equal(capture.headCommit, baseline.baseCommit);
    assert.equal(capture.repositoryId, baseline.repositoryId);
    const patch = Buffer.from(capture.patch).toString("utf8");
    assert.match(patch, /\+after/u);
    assert.match(patch, /nested\/untracked\.txt/u);
    assert.match(patch, /\+new/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("Git delivery evidence reports a provider-neutral fallback outside a repository", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rah-os-delivery-files-"));
  try {
    const baseline =
      await new GitTaskDeliveryEvidenceCollector().captureBaseline({
        workspaceRoot: directory,
      });
    assert.equal(baseline.source, "unavailable");
    if (baseline.source !== "unavailable") return;
    assert.equal(baseline.reason, "not_git");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("Git delivery evidence from a subdirectory restores one repository-relative tree", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rah-os-delivery-subdir-"));
  const checkout = await mkdtemp(join(tmpdir(), "rah-os-delivery-apply-"));
  try {
    await git(directory, "init");
    await git(directory, "config", "user.email", "test@rah.invalid");
    await git(directory, "config", "user.name", "RAH Test");
    await mkdir(join(directory, "pkg"));
    await writeFile(join(directory, "pkg", "tracked.txt"), "before\n");
    await git(directory, "add", "pkg/tracked.txt");
    await git(directory, "commit", "-m", "base");

    const workspaceRoot = join(directory, "pkg");
    const collector = new GitTaskDeliveryEvidenceCollector();
    const baseline = await collector.captureBaseline({ workspaceRoot });
    assert.equal(baseline.source, "git");
    if (baseline.source !== "git") return;

    await writeFile(join(workspaceRoot, "tracked.txt"), "after\n");
    await writeFile(join(workspaceRoot, "new file.txt"), "new\n");
    const capture = await collector.captureSubmission({ baseline });

    await git(checkout, "init");
    await git(
      directory,
      "archive",
      "--format=tar",
      "HEAD",
      "-o",
      join(checkout, "base.tar"),
    );
    await execFile("/usr/bin/tar", ["-xf", "base.tar"], { cwd: checkout });
    await rm(join(checkout, "base.tar"));
    await writeFile(join(checkout, "delivery.patch"), capture.patch);
    await git(checkout, "apply", "--binary", "delivery.patch");

    assert.equal(
      await readFile(join(checkout, "pkg", "tracked.txt"), "utf8"),
      "after\n",
    );
    assert.equal(
      await readFile(join(checkout, "pkg", "new file.txt"), "utf8"),
      "new\n",
    );
    await assert.rejects(readFile(join(checkout, "new file.txt")), /ENOENT/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
    await rm(checkout, { force: true, recursive: true });
  }
});

test("Git delivery evidence treats a metacharacter workspace as one literal directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rah-os-delivery-literal-"));
  const checkout = await mkdtemp(
    join(tmpdir(), "rah-os-delivery-literal-apply-"),
  );
  try {
    await git(directory, "init");
    await git(directory, "config", "user.email", "test@rah.invalid");
    await git(directory, "config", "user.name", "RAH Test");
    await mkdir(join(directory, "pkg*"));
    await mkdir(join(directory, "pkg-other"));
    await writeFile(join(directory, "pkg*", "in.txt"), "before\n");
    await writeFile(
      join(directory, "pkg-other", "out.txt"),
      "outside before\n",
    );
    await git(directory, "add", "--", "pkg*/in.txt", "pkg-other/out.txt");
    await git(directory, "commit", "-m", "base");

    const workspaceRoot = join(directory, "pkg*");
    const collector = new GitTaskDeliveryEvidenceCollector();
    const baseline = await collector.captureBaseline({ workspaceRoot });
    assert.equal(baseline.source, "git");
    if (baseline.source !== "git") return;

    await writeFile(join(workspaceRoot, "in.txt"), "after\n");
    await writeFile(join(workspaceRoot, "new.txt"), "inside new\n");
    await writeFile(join(directory, "pkg-other", "out.txt"), "outside after\n");
    await writeFile(join(directory, "pkg-other", "new.txt"), "outside new\n");
    const capture = await collector.captureSubmission({ baseline });
    const patch = Buffer.from(capture.patch).toString("utf8");

    assert.match(patch, /pkg\*\/in\.txt/u);
    assert.match(patch, /pkg\*\/new\.txt/u);
    assert.doesNotMatch(patch, /pkg-other/u);

    await git(checkout, "init");
    await git(
      directory,
      "archive",
      "--format=tar",
      "HEAD",
      "-o",
      join(checkout, "base.tar"),
    );
    await execFile("/usr/bin/tar", ["-xf", "base.tar"], { cwd: checkout });
    await rm(join(checkout, "base.tar"));
    await writeFile(join(checkout, "delivery.patch"), capture.patch);
    await git(checkout, "apply", "--binary", "delivery.patch");

    assert.equal(
      await readFile(join(checkout, "pkg*", "in.txt"), "utf8"),
      "after\n",
    );
    assert.equal(
      await readFile(join(checkout, "pkg*", "new.txt"), "utf8"),
      "inside new\n",
    );
    assert.equal(
      await readFile(join(checkout, "pkg-other", "out.txt"), "utf8"),
      "outside before\n",
    );
    await assert.rejects(
      readFile(join(checkout, "pkg-other", "new.txt")),
      /ENOENT/u,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
    await rm(checkout, { force: true, recursive: true });
  }
});

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFile("git", args, { cwd });
}
