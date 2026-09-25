// Writes the test-only guarded executable the isolated gate daemon launches
// instead of the provider CLI; every model request crosses its fence.
import { writeFileSync } from "node:fs";

const MODULES = {
  codex: ["./model-guard.mjs", "runGuardedCodex"],
  claude: ["./claude-guard.mjs", "runGuardedClaude"],
  kimi: ["./drift-kimi-guard.mjs", "runGuardedKimi"],
  opencode: ["./drift-opencode-guard.mjs", "runGuardedOpenCode"],
};

// options: codex {socketRecordPath}; claude {injectRecordPath} (warm drift);
// opencode {compactionOptions, controlRecordPath?}. Claude effort null is the
// effortless (Haiku) approval.
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
  const [module, fn] = entry;
  const href = new URL(module, import.meta.url).href;
  const approved =
    provider === "codex" ? { model, effort, ...options } : { model, effort };
  const extra =
    provider === "claude" || provider === "opencode"
      ? `, ${JSON.stringify(options)}`
      : "";
  writeFileSync(
    path,
    `#!/usr/bin/env node\nimport {${fn}} from ${JSON.stringify(href)};\nawait ${fn}(${JSON.stringify(realCli)}, ${JSON.stringify(approved)}${extra});\n`,
    { mode: 0o700 },
  );
  return path;
}
