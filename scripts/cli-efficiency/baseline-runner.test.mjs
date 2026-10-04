import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "loom-baseline-plan-"));
  const marker = join(root, "unexpected-provider-start");
  for (const name of ["codex", "kimi", "opencode"])
    writeFileSync(
      join(root, name),
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo '${name}-cli test-version'; exit 0; fi\necho attempted > '${marker}'\nexit 99\n`,
      { mode: 0o700 },
    );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !k.startsWith("RAH_EFFICIENCY_"),
    ),
  );
  return {
    root,
    marker,
    run: (args, extra = {}) =>
      spawnSync(
        process.execPath,
        [resolve("scripts/test-cli-efficiency.mjs"), ...args],
        {
          encoding: "utf8",
          env: {
            ...env,
            PATH: root + ":" + process.env.PATH,
            RAH_EFFICIENCY_PROVIDER: "codex",
            RAH_EFFICIENCY_ORDER: "native,role-warm",
            ...extra,
          },
        },
      ),
  };
}

test("free plan freezes P97 source rather than HEAD, and never starts a model", () => {
  const f = fixture();
  try {
    const r = f.run(["--plan"]);
    assert.equal(r.status, 0, r.stderr);
    const plan = JSON.parse(r.stdout);
    assert.equal(plan.status, "planned");
    assert.equal(plan.sourceRef, "4b8e7e5897e024fbe17dc08fbcf5beb556e5ee6b");
    assert.equal(plan.baseline.identity.workload.id, "p97-direct-review-v1");
    assert.equal(
      plan.baseline.identity.runtime.cliVersion,
      "codex-cli test-version",
    );
    assert.equal(plan.nativeMemoryPolicy.supported, true);
    assert.equal(plan.arms.native, undefined);
    assert.equal(existsSync(f.marker), false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("an unverified memory policy fails before paid provider startup", () => {
  const f = fixture();
  try {
    const r = f.run(["--paid"], {
      RAH_EFFICIENCY_PROVIDER: "kimi",
      RAH_EFFICIENCY_ORDER: "native,role",
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /memory/i);
    assert.equal(existsSync(f.marker), false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
