// Read-only selected-source comparison; never edits pins or claims whole-App parity.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = resolve("frontends/raft/upstream/raft-mobile-source"),
  lock = JSON.parse(readFileSync(root + "/source-lock.json", "utf8")),
  candidate = process.argv[2];
if (!candidate)
  throw Error(
    "Usage: node scripts/official-web/audit-mobile-source.mjs /path/to/mobile-checkout",
  );
const git = (...args) =>
  execFileSync("git", ["-C", candidate, ...args], { encoding: "utf8" }).trim();
const hash = (p) =>
  existsSync(p)
    ? createHash("sha256").update(readFileSync(p)).digest("hex")
    : null;
const rows = lock.files.map((f) => ({
  path: f.path,
  localDrift: hash(resolve(root, f.path)) !== f.sha256,
  candidateSha256: hash(resolve(candidate, f.path)),
  changed: hash(resolve(candidate, f.path)) !== f.sha256,
}));
const dirty = git("status", "--porcelain");
console.log(
  JSON.stringify(
    {
      repository: lock.repository,
      baseline: lock.commit,
      candidate: git("rev-parse", "HEAD"),
      candidateDirty: Boolean(dirty),
      scope: lock.scope,
      files: rows,
    },
    null,
    2,
  ),
);
if (dirty || rows.some((r) => r.localDrift || !r.candidateSha256))
  process.exitCode = 2;
