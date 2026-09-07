import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { summarizeWorkspaceRoot } from "../src/workspace-summary.ts";

test("workspace summary counts bounded browsable files without following links or exposing secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "rah-workspace-summary-"));
  try {
    await mkdir(join(root, "notes"));
    await writeFile(join(root, "MEMORY.md"), "index");
    await writeFile(join(root, "notes", "entry.md"), "note");
    await writeFile(join(root, ".env"), "not counted");
    await symlink("/tmp", join(root, "outside"));
    const result = await summarizeWorkspaceRoot(root);
    assert.equal(result.state, "ready");
    assert.equal(result.fileCount, 2);
    assert.equal(result.totalSizeBytes, 9);
    assert.equal(result.truncated, false);
    assert.ok(result.lastModified);
    const bounded = await summarizeWorkspaceRoot(root, {
      maximumDirectories: 1,
    });
    assert.equal(bounded.truncated, true);
    assert.equal(bounded.fileCount, 1);
    const absent = await summarizeWorkspaceRoot(join(root, "missing"));
    assert.equal(absent.state, "absent");
    assert.equal(absent.fileCount, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unmaterialized Agent workspace reports absent without creating memory files", async () => {
  const { AgentMemoryCoordinator } =
    await import("../src/agent-memory-coordinator.ts");
  const root = await mkdtemp(join(tmpdir(), "rah-summary-absent-"));
  const coordinator = new AgentMemoryCoordinator({
    rootDirectory: join(root, "missing-parent"),
    wake: () => false,
    acquireResetFence: async () => ({ release() {} }),
    quarantineProviderContinuity: async () => ({
      recordCount: 0,
      rollback() {},
    }),
  });
  try {
    assert.equal(
      (await coordinator.summarizeWorkspace("alice")).state,
      "absent",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
