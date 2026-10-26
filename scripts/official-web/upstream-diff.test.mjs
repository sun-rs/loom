import test from "node:test";
import assert from "node:assert/strict";
import { classify } from "./upstream-diff.mjs";
test("upstream comparison separates shared bytes, one-sided edits and overlapping edits", () => {
  assert.equal(classify("base", "base", "base"), "identical");
  assert.equal(classify("base", "new", "new"), "identical");
  assert.equal(classify("base", "base", "new"), "upstream-only");
  assert.equal(classify("base", "local", "base"), "loom-only");
  assert.equal(classify("base", "local", "new"), "both-changed-review");
  assert.equal(classify("base", "local", null), "missing-upstream");
  assert.equal(classify("base", null, "new"), "missing-loom");
});

import { inventoryDependency } from "./upstream-diff.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
test("dependency audit compares upstream directly and separately detects forbidden local edits", () => {
  const root = mkdtempSync(join(tmpdir(), "loom-source-diff-"));
  try {
    const local = join(root, "local"),
      upstream = join(root, "upstream");
    mkdirSync(local);
    mkdirSync(upstream);
    const digest = createHash("sha256").update("original").digest("hex");
    writeFileSync(
      join(local, "source-lock.json"),
      JSON.stringify({
        revision: "pinned",
        files: { "component.tsx": digest },
      }),
    );
    writeFileSync(join(local, "component.tsx"), "original");
    writeFileSync(join(upstream, "component.tsx"), "updated");
    let report = inventoryDependency(local, upstream);
    assert.equal(report.rows[0].status, "upstream-only");
    assert.equal(report.rows[0].unexpectedLocalDrift, false);
    writeFileSync(join(local, "component.tsx"), "local edit");
    report = inventoryDependency(local, upstream);
    assert.equal(report.rows[0].status, "both-changed-review");
    assert.equal(report.rows[0].unexpectedLocalDrift, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import {
  summarize,
  candidateIdentity,
  comparisonExitCode,
} from "./upstream-diff.mjs";
import { execFileSync } from "node:child_process";
test("summary exposes upstream deltas, missing sources and local drift independently", () => {
  const rows = [
    { status: "identical", unexpectedLocalDrift: false },
    { status: "upstream-only", unexpectedLocalDrift: false },
    { status: "missing-upstream", unexpectedLocalDrift: false },
    { status: "identical", unexpectedLocalDrift: true },
  ];
  assert.deepEqual(summarize(rows), {
    total: 4,
    byStatus: { identical: 2, "upstream-only": 1, "missing-upstream": 1 },
    unexpectedLocalDrift: 1,
  });
  assert.equal(
    comparisonExitCode({ rows: rows.slice(0, 2), sourceDependency: null }),
    0,
  );
  assert.equal(
    comparisonExitCode({ rows: [], sourceDependency: { rows: [rows[3]] } }),
    2,
  );
  assert.equal(
    comparisonExitCode({ rows: [rows[2]], sourceDependency: null }),
    2,
  );
});
test("candidate metadata distinguishes clean commits, dirty checkouts and directory snapshots", () => {
  const root = mkdtempSync(join(tmpdir(), "loom-upstream-identity-"));
  const git = (args) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  try {
    assert.deepEqual(candidateIdentity(root), {
      revision: null,
      dirty: null,
      kind: "directory-snapshot",
    });
    git(["init", "-q"]);
    writeFileSync(join(root, "source.ts"), "initial");
    git(["add", "."]);
    git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "initial",
    ]);
    assert.deepEqual(candidateIdentity(root), {
      revision: git(["rev-parse", "HEAD"]),
      dirty: false,
      kind: "git-checkout",
    });
    writeFileSync(join(root, "untracked.ts"), "extra");
    assert.equal(candidateIdentity(root).dirty, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("candidate discovery includes new source files outside the pinned inventory without treating them as adopted", async () => {
  const { discoverUntrackedCandidateFiles } =
    await import("./upstream-diff.mjs");
  const root = mkdtempSync(join(tmpdir(), "loom-candidate-coverage-"));
  try {
    mkdirSync(join(root, "packages/web/src"), { recursive: true });
    writeFileSync(join(root, "packages/web/src/existing.tsx"), "old");
    writeFileSync(join(root, "packages/web/src/new-theme.tsx"), "new");
    assert.deepEqual(
      discoverUntrackedCandidateFiles(root, ["packages/web/src/existing.tsx"]),
      ["packages/web/src/new-theme.tsx"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
