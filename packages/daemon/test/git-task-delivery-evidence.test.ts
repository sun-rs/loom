import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFile("git", args, { cwd });
}
