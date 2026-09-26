import assert from "node:assert/strict";
import test from "node:test";

import {
  captureDeliveryEvidenceBaseline,
  type TaskDeliveryEvidenceCollector,
} from "../src/index.ts";

/**
 * Owner 2026-09-26 channel workspace: a channel home is a platform
 * directory, normally not a git repository. Task delivery evidence comes from
 * the first attached directory that is a git worktree (creation order); with
 * none, from the cwd, and a non-git result is recorded as it is.
 */
function collector(gitRoots: string[]) {
  const calls: string[] = [];
  const value: TaskDeliveryEvidenceCollector = {
    async captureBaseline({ workspaceRoot }) {
      calls.push(workspaceRoot);
      return gitRoots.includes(workspaceRoot)
        ? {
            baseCommit: "1".repeat(40),
            repositoryId: `sha256:${"a".repeat(64)}`,
            source: "git",
            workspaceRoot,
          }
        : { reason: "not_git", source: "unavailable", workspaceRoot };
    },
    async captureSubmission() {
      throw new Error("unused");
    },
  };
  return { calls, value };
}

test("the first git attached directory is the evidence root", async () => {
  const c = collector(["/work/lib", "/work/tools"]);
  const baseline = await captureDeliveryEvidenceBaseline(c.value, {
    workspaceRoot: "/homes/room-1",
    attachedDirectories: ["/work/docs", "/work/lib", "/work/tools"],
  });
  assert.equal(baseline.source, "git");
  assert.equal(baseline.workspaceRoot, "/work/lib");
  assert.deepEqual(c.calls, ["/work/docs", "/work/lib"]);
});

test("without a git attached directory the cwd is captured and a non-git result is recorded as it is", async () => {
  const c = collector(["/homes/room-1"]);
  assert.equal(
    (
      await captureDeliveryEvidenceBaseline(c.value, {
        workspaceRoot: "/homes/room-1",
        attachedDirectories: ["/work/docs"],
      })
    ).workspaceRoot,
    "/homes/room-1",
  );
  const none = collector([]);
  const baseline = await captureDeliveryEvidenceBaseline(none.value, {
    workspaceRoot: "/homes/room-2",
    attachedDirectories: ["/work/docs"],
  });
  assert.deepEqual(baseline, {
    reason: "not_git",
    source: "unavailable",
    workspaceRoot: "/homes/room-2",
  });
  const plain = collector([]);
  await captureDeliveryEvidenceBaseline(plain.value, {
    workspaceRoot: "/private/agent",
  });
  assert.deepEqual(plain.calls, ["/private/agent"]);
});

test("a collector failure on one attached directory falls through; without a collector the cwd is recorded unavailable", async () => {
  const failing: TaskDeliveryEvidenceCollector = {
    async captureBaseline({ workspaceRoot }) {
      if (workspaceRoot === "/work/broken") throw new Error("boom");
      return { reason: "not_git", source: "unavailable", workspaceRoot };
    },
    async captureSubmission() {
      throw new Error("unused");
    },
  };
  assert.deepEqual(
    await captureDeliveryEvidenceBaseline(failing, {
      workspaceRoot: "/homes/room-1",
      attachedDirectories: ["/work/broken"],
    }),
    {
      reason: "not_git",
      source: "unavailable",
      workspaceRoot: "/homes/room-1",
    },
  );
  assert.deepEqual(
    await captureDeliveryEvidenceBaseline(undefined, {
      workspaceRoot: "/homes/room-1",
      attachedDirectories: ["/work/app"],
    }),
    {
      reason: "collector_unavailable",
      source: "unavailable",
      workspaceRoot: "/homes/room-1",
    },
  );
});
