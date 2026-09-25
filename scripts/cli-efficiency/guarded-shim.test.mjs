import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeGuardedShim } from "./guarded-shim.mjs";

const dir = mkdtempSync(join(tmpdir(), "loom-shim-test-"));
const read = (provider, options) =>
  readFileSync(
    writeGuardedShim({
      provider,
      path: join(dir, `${provider}.mjs`),
      realCli: "/bin/real",
      model: "m",
      effort: "e",
      options,
    }),
    "utf8",
  );

test("each provider's shim calls its own guard with the exact model/effort", () => {
  const codex = read("codex", { socketRecordPath: "/r" });
  assert.match(
    codex,
    /runGuardedCodex\("\/bin\/real", \{"model":"m","effort":"e","socketRecordPath":"\/r"\}\)/,
  );
  const claude = read("claude", { injectRecordPath: "/i" });
  assert.match(claude, /claude-guard\.mjs/);
  assert.match(
    claude,
    /runGuardedClaude\("\/bin\/real", \{"model":"m","effort":"e"\}, \{"injectRecordPath":"\/i"\}\)/,
  );
  const kimi = read("kimi");
  assert.match(
    kimi,
    /runGuardedKimi\("\/bin\/real", \{"model":"m","effort":"e"\}\)/,
  );
  assert.equal(statSync(join(dir, "kimi.mjs")).mode & 0o777, 0o700);
  const opencode = read("opencode", {
    compactionOptions: { reasoningEffort: "e" },
  });
  assert.match(opencode, /drift-opencode-guard\.mjs/);
  assert.match(
    opencode,
    /runGuardedOpenCode\("\/bin\/real", \{"model":"m","effort":"e"\}, \{"compactionOptions":\{"reasoningEffort":"e"\}\}\)/,
  );
  assert.throws(() => read("gemini"), /No gate guard/);
});
