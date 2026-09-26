// Evidence provenance and output for the paid gates. `codeProvenance`
// records the code under test (HEAD plus a working-tree summary that
// includes untracked files) separately from the question snapshot ref, so an
// evidence file states which code it measured. `writeEvidence` writes the
// raw result (0600) and a redacted copy (temporary root and home replaced)
// that carries the raw file's sha256, so a committed redacted file can be
// matched against the gate's original output.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const defaultGit = (args) => execFileSync("git", args, { encoding: "utf8" });

export function codeProvenance({ git = defaultGit, sourceRef = "HEAD" } = {}) {
  const status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  const lines = status.split("\n").filter(Boolean);
  return {
    codeCommit: git(["rev-parse", "HEAD"]).trim(),
    // The fixed question/source snapshot the gate copies into its workspace.
    sourceRef: git(["rev-parse", sourceRef]).trim(),
    workingTree: {
      dirty: lines.length > 0,
      changedPaths: lines.length,
      untrackedPaths: lines.filter((l) => l.startsWith("??")).length,
      statusSha256: sha256(status),
      diffSha256: sha256(git(["diff", "HEAD"])),
    },
  };
}

const canonical = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
};

// The canonical root first: it may contain the given root as a substring
// (macOS /private/var/... vs /var/...).
export function redactEvidence(result, { root, home = homedir() }) {
  let text = JSON.stringify(result, null, 2) + "\n";
  const realRoot = root ? canonical(root) : undefined;
  for (const [from, to] of [
    ...(realRoot && realRoot !== root ? [[realRoot, "<tmp>"]] : []),
    [root, "<tmp>"],
    [home, "~"],
  ])
    if (from) text = text.split(from).join(to);
  return text;
}

export function writeEvidence(root, result, { home } = {}) {
  const rawPath = join(root, "result.json");
  const redactedPath = join(root, "result.redacted.json");
  const raw = JSON.stringify(result, null, 2) + "\n";
  writeFileSync(rawPath, raw, { mode: 0o600 });
  const rawSha256 = sha256(raw);
  writeFileSync(
    redactedPath,
    redactEvidence({ ...result, rawResultSha256: rawSha256 }, { root, home }),
    { mode: 0o600 },
  );
  return { rawPath, redactedPath, rawSha256 };
}
