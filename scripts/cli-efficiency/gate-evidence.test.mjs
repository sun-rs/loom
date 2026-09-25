import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  codeProvenance,
  redactEvidence,
  writeEvidence,
} from "./gate-evidence.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");

test("provenance: code under test (HEAD + working tree incl. untracked) apart from the question snapshot ref", () => {
  const calls = [];
  const git = (args) => {
    calls.push(args.join(" "));
    if (args[0] === "rev-parse" && args[1] === "HEAD") return "aaa111\n";
    if (args[0] === "rev-parse") return "bbb222\n";
    if (args[0] === "status") return " M a.mjs\n?? new.mjs\n";
    if (args[0] === "diff") return "diff --git a/a.mjs\n";
    throw new Error("unexpected git " + args.join(" "));
  };
  const p = codeProvenance({ git, sourceRef: "5122795" });
  assert.equal(p.codeCommit, "aaa111");
  assert.equal(p.sourceRef, "bbb222");
  assert.deepEqual(p.workingTree, {
    dirty: true,
    changedPaths: 2,
    untrackedPaths: 1,
    statusSha256: sha(" M a.mjs\n?? new.mjs\n"),
    diffSha256: sha("diff --git a/a.mjs\n"),
  });
  assert.ok(calls.includes("status --porcelain=v1 --untracked-files=all"));
  const clean = codeProvenance({
    git: (args) => (args[0] === "rev-parse" ? "ccc\n" : ""),
  });
  assert.equal(clean.codeCommit, "ccc");
  assert.equal(clean.sourceRef, "ccc");
  assert.equal(clean.workingTree.dirty, false);
});

test("redaction replaces the temporary root and home, raw digest kept", () => {
  const dir = mkdtempSync(join(tmpdir(), "loom-evidence-"));
  const result = {
    root: dir,
    arms: { native: { cwd: join(dir, "native/workspace") } },
    home: "/Users/someone/.codex/sessions/x.jsonl",
  };
  const text = redactEvidence(result, { root: dir, home: "/Users/someone" });
  assert.ok(!text.includes(dir));
  assert.ok(!text.includes("/Users/someone"));
  assert.match(text, /<tmp>\/native\/workspace/);
  assert.match(text, /~\/\.codex/);
  const written = writeEvidence(dir, result, { home: "/Users/someone" });
  const raw = readFileSync(written.rawPath, "utf8");
  assert.equal(written.rawSha256, sha(raw));
  const redacted = JSON.parse(readFileSync(written.redactedPath, "utf8"));
  assert.equal(redacted.rawResultSha256, written.rawSha256);
  assert.equal(redacted.root, "<tmp>");
  assert.equal(JSON.parse(raw).root, dir);
});
