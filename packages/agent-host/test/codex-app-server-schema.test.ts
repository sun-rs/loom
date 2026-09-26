import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

/**
 * Locks the experimental Codex app-server field the channel workspace relies
 * on (owner 2026-09-26). `generate-ts --experimental` only prints bindings;
 * it starts no model. Skipped when no `codex` is installed on this machine.
 */
const codex = spawnSync("codex", ["--version"], { encoding: "utf8" });

test(
  "Codex app-server thread/start and thread/resume accept runtimeWorkspaceRoots",
  { skip: codex.status !== 0 ? "codex CLI is not installed" : false },
  () => {
    const out = mkdtempSync(join(tmpdir(), "rah-codex-schema-"));
    try {
      const generated = spawnSync(
        "codex",
        ["app-server", "generate-ts", "--experimental", "--out", out],
        { encoding: "utf8", timeout: 60_000 },
      );
      assert.equal(generated.status, 0, generated.stderr);
      for (const file of ["ThreadStartParams.ts", "ThreadResumeParams.ts"]) {
        const source = readFileSync(join(out, "v2", file), "utf8");
        assert.match(
          source,
          /runtimeWorkspaceRoots\?: Array<AbsolutePathBuf>/u,
          `${file} (${codex.stdout.trim()})`,
        );
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  },
);
