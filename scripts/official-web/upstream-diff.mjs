// Read-only three-way inventory. It never merges, rewrites provenance or declares UI parity.
import { readFileSync, existsSync } from "node:fs";
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
export function inventoryDependency(localRoot, upstreamRoot) {
  const lock = JSON.parse(readFileSync(resolve(localRoot, "source-lock.json"), "utf8"));
  return {
    baseRevision: lock.revision,
    rows: Object.entries(lock.files).map(([file, base]) => {
      const local = hash(resolve(localRoot, file)), upstream = hash(resolve(upstreamRoot, file));
      return { file, status: classify(base, local, upstream), base, local, upstream,
        unexpectedLocalDrift: local !== base };
    }),
  };
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
    sourceDependency: existsSync(resolve(localRoot, "upstream/raft-web-source/source-lock.json"))
      ? inventoryDependency(resolve(localRoot, "upstream/raft-web-source"), upstreamRoot) : null,
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
  try {
    report.comparedRevision = execFileSync(
      "git",
      ["-C", resolve(upstream), "rev-parse", "HEAD"],
      { encoding: "utf8" },
    ).trim();
  } catch {
    report.comparedRevision = "unknown (directory snapshot)";
  }
  console.log(JSON.stringify(report, null, 2));
}
