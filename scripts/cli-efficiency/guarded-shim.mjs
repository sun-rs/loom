// Writes the test-only guarded executable the isolated gate daemon launches
// instead of the provider CLI; every model request crosses its fence. A shim
// is written only for a combination in the owner approval table.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { assertApprovedGateModel } from "./approved-models.mjs";

const MODULES = {
  codex: ["./model-guard.mjs", "runGuardedCodex"],
  claude: ["./claude-guard.mjs", "runGuardedClaude"],
  kimi: ["./drift-kimi-guard.mjs", "runGuardedKimi"],
  opencode: ["./drift-opencode-guard.mjs", "runGuardedOpenCode"],
};

// Post-hoc violations a guard observed after forwarding (JSON lines).
export const guardViolationPath = (shimPath) => `${shimPath}.violations.jsonl`;

export function assertNoGuardViolations(shimPath) {
  const path = guardViolationPath(shimPath);
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
  if (lines.length)
    throw new Error(
      `Guard recorded ${lines.length} violation(s): ${lines[0].slice(0, 300)}`,
    );
}

// options: codex {socketRecordPath}; claude {injectRecordPath} (warm drift);
// opencode {compactionOptions, controlRecordPath?}. Claude effort null is the
// effortless (Haiku) approval. Claude additionally records post-hoc model
// violations next to the shim (see assertNoGuardViolations).
export function writeGuardedShim({
  provider,
  path,
  realCli,
  model,
  effort,
  options = {},
}) {
  const entry = MODULES[provider];
  if (!entry) throw new Error(`No gate guard for ${provider}`);
  assertApprovedGateModel({ provider, model, effort });
  const [module, fn] = entry;
  const href = new URL(module, import.meta.url).href;
  const approved =
    provider === "codex" ? { model, effort, ...options } : { model, effort };
  const shimOptions =
    provider === "claude"
      ? { ...options, violationRecordPath: guardViolationPath(path) }
      : options;
  const extra =
    provider === "claude" || provider === "opencode"
      ? `, ${JSON.stringify(shimOptions)}`
      : "";
  writeFileSync(
    path,
    `#!/usr/bin/env node\nimport {${fn}} from ${JSON.stringify(href)};\nawait ${fn}(${JSON.stringify(realCli)}, ${JSON.stringify(approved)}${extra});\n`,
    { mode: 0o700 },
  );
  return path;
}
