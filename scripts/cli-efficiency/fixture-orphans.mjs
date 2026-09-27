// One-off listing of orphaned fake `opencode serve` processes left by
// drift-opencode-guard.test.mjs before full review 2 B-P2-1 (the test killed
// only its shim, so the shim's fake serve child survived). Lists, never
// kills: the owner decides. Matches the exact fixture script path the test
// wrote (<tmpdir>/loom-og-record-XXXXXX/fake-opencode.mjs or
// loom-og-test-XXXXXX) followed by `serve`; nothing else.
//
//   node scripts/cli-efficiency/fixture-orphans.mjs
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const tmpRoots = () => {
  const roots = new Set([tmpdir().replace(/\/$/u, "")]);
  try {
    roots.add(realpathSync(tmpdir()));
  } catch {
    // tmpdir without a canonical form
  }
  return [...roots];
};

// psText: `ps -axo pid=,ppid=,etime=,command=` output.
export function matchOpenCodeFixtureOrphans(psText, roots = tmpRoots()) {
  const script = new RegExp(
    `^(?:\\S*/)?node (?:${roots.map(escape).join("|")})/loom-og-(?:record|test)-[A-Za-z0-9]{6}/fake-opencode\\.mjs serve(?: |$)`,
    "u",
  );
  const out = [];
  for (const line of psText.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/u.exec(line);
    if (!m || !script.test(m[4])) continue;
    out.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      elapsed: m[3],
      command: m[4],
    });
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const orphans = matchOpenCodeFixtureOrphans(
    execFileSync("ps", ["-axo", "pid=,ppid=,etime=,command="], {
      encoding: "utf8",
    }),
  );
  if (!orphans.length) console.log("No orphaned fake opencode serve process.");
  else {
    console.log(`${String(orphans.length)} orphaned fake opencode serve:`);
    for (const o of orphans)
      console.log(
        `${String(o.pid)}\tppid ${String(o.ppid)}\t${o.elapsed}\t${o.command}`,
      );
    console.log(
      `Not killed. Suggested (after review): kill ${orphans.map((o) => o.pid).join(" ")}`,
    );
  }
}
