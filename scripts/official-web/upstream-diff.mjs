// Read-only three-way inventory. It never merges, rewrites provenance or declares UI parity.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
export function classify(base, local, upstream) {
  if (local === null) return "missing-loom";
  if (upstream === null) return "missing-upstream";
  if (local === upstream) return "identical";
  if (local === base) return "upstream-only";
  if (upstream === base) return "loom-only";
  return "both-changed-review";
}
function hash(path) {
  return existsSync(path)
    ? createHash("sha256").update(readFileSync(path)).digest("hex")
    : null;
}
export function summarize(rows) {
  return {
    total: rows.length,
    byStatus: rows.reduce((out, row) => {
      out[row.status] = (out[row.status] ?? 0) + 1;
      return out;
    }, {}),
    unexpectedLocalDrift: rows.filter((row) => row.unexpectedLocalDrift).length,
  };
}
export function comparisonExitCode(report) {
  const rows = [...report.rows, ...(report.sourceDependency?.rows ?? [])];
  return rows.some(
    (row) =>
      row.unexpectedLocalDrift ||
      row.status === "missing-upstream" ||
      row.status === "missing-loom",
  )
    ? 2
    : 0;
}
export function candidateIdentity(root) {
  const git = (args) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    return {
      revision: git(["rev-parse", "HEAD"]),
      dirty: git(["status", "--porcelain", "--untracked-files=all"]).length > 0,
      kind: "git-checkout",
    };
  } catch {
    return { revision: null, dirty: null, kind: "directory-snapshot" };
  }
}
export function inventoryDependency(localRoot, upstreamRoot) {
  const lock = JSON.parse(
    readFileSync(resolve(localRoot, "source-lock.json"), "utf8"),
  );
  const rows = Object.entries(lock.files).map(([file, base]) => {
    const local = hash(resolve(localRoot, file)),
      upstream = hash(resolve(upstreamRoot, file));
    return {
      file,
      status: classify(base, local, upstream),
      base,
      local,
      upstream,
      unexpectedLocalDrift: local !== base,
    };
  });
  return { baseRevision: lock.revision, summary: summarize(rows), rows };
}

// Discovery is intentionally separate from byte parity: untracked does not mean new
// since the pin, missing in Loom, or required by the product.
export function discoverUntrackedCandidateFiles(root, tracked) {
  const known = new Set(tracked),
    result = [];
  function visit(relative) {
    const path = resolve(root, relative);
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && !known.has(file)) result.push(file);
    }
  }
  visit("packages/web/src");
  return result.sort();
}

export function inventory(localRoot, upstreamRoot) {
  const adoption = JSON.parse(
    readFileSync(resolve(localRoot, "adoption.json"), "utf8"),
  );
  const ports = JSON.parse(
    readFileSync(resolve(localRoot, "rui-v6-ports.json"), "utf8"),
  );
  const rows = Object.entries(adoption.files).map(([file, base]) => {
    const local = hash(resolve(localRoot, file)),
      upstream = hash(resolve(upstreamRoot, file));
    return {
      file,
      status: classify(base, local, upstream),
      base,
      local,
      upstream,
      recordedLocalEdit: Boolean(ports.files[file]),
      unexpectedLocalDrift: local !== (ports.files[file]?.portedSha256 ?? base),
    };
  });
  return {
    baseRevision: adoption.revision,
    candidateDiscovery: {
      scope: "packages/web/src",
      untrackedFiles: discoverUntrackedCandidateFiles(
        upstreamRoot,
        Object.keys(adoption.files),
      ),
      status:
        "Unclassified; not automatic adoption requirements or proof of newly added features",
    },
    pageParity: {
      status: "not-evaluated",
      reason:
        "Production routes, default states, new features and Loom compositions need independent coverage",
    },
    sourceDependency: existsSync(
      resolve(localRoot, "upstream/raft-web-source/source-lock.json"),
    )
      ? inventoryDependency(
          resolve(localRoot, "upstream/raft-web-source"),
          upstreamRoot,
        )
      : null,
    summary: rows.reduce((out, row) => {
      out[row.status] = (out[row.status] ?? 0) + 1;
      return out;
    }, {}),
    rows,
    limits: [
      "Byte comparison, not semantic or visual acceptance",
      "Missing upstream may mean a sparse checkout, not deletion",
      "Loom-only pages in loom/ have no upstream path identity and require explicit composition mappings",
      "Baseline is original intake; later structural ports are recorded local edits, not a fabricated newer common ancestor",
    ],
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const upstream = process.argv[2];
  if (!upstream || !existsSync(resolve(upstream, "packages/web/src"))) {
    throw Error(
      "Usage: node scripts/official-web/upstream-diff.mjs /path/to/official-source-checkout (must include packages/web/src)",
    );
  }
  const root = resolve(import.meta.dirname, "../../frontends/raft");
  const report = inventory(root, resolve(upstream));
  report.candidate = candidateIdentity(resolve(upstream));
  report.comparedRevision =
    report.candidate.revision ?? "unknown (directory snapshot)";
  report.localIntegrity = summarize([
    ...report.rows,
    ...(report.sourceDependency?.rows ?? []),
  ]);
  report.acceptance =
    "Not evaluated: source differences require scoped generation/build/browser review";
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = comparisonExitCode(report);
}
