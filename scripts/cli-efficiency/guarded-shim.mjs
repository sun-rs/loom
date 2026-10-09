// Writes the test-only guarded executable the isolated gate daemon launches
// instead of the provider CLI; every model request crosses its fence. A shim
// is written only for a combination in the owner approval table.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { assertApprovedGateModel } from "./approved-models.mjs";
import { readOpenCodeCompactionOptions } from "./drift-opencode-guard.mjs";

const MODULES = {
  codex: ["./model-guard.mjs", "runGuardedCodex"],
  claude: ["./claude-guard.mjs", "runGuardedClaude"],
  kimi: ["./drift-kimi-guard.mjs", "runGuardedKimi"],
  opencode: ["./drift-opencode-guard.mjs", "runGuardedOpenCode"],
};

// Transport-only option keys per provider (Codex review of batches 3-4
// P2-1). The approved model/effort come only from the approval table, so an
// option can never carry or override them.
const TRANSPORT_OPTIONS = {
  codex: new Set(["socketRecordPath", "requestRecordPath", "execTransport"]),
  claude: new Set(["injectRecordPath"]),
  kimi: new Set(),
  opencode: new Set([
    "compactionOptions",
    "controlRecordPath",
    "requestRecordPath",
  ]),
};

// The gate's shim options (efficiency and drift arms alike): OpenCode's
// compaction reasoning options are resolved here, from the installed CLI's
// verbose catalog, and never accepted from a caller.
export function resolveGateShimOptions({
  provider,
  realCli,
  model,
  effort,
  options = {},
}) {
  if (provider !== "opencode") return options;
  if (options?.compactionOptions !== undefined)
    throw new Error(
      "OpenCode compaction options come from the CLI catalog, not the caller",
    );
  return {
    ...options,
    compactionOptions: readOpenCodeCompactionOptions(realCli, model, effort),
  };
}

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

// options: codex {socketRecordPath, requestRecordPath, execTransport?};
// execTransport is the explicit ordinary exec mode; its violations are recorded.
// claude {injectRecordPath} (warm drift);
// opencode {compactionOptions, controlRecordPath?}. Claude effort null is the
// effortless (Haiku) approval. Claude additionally records post-hoc model
// violations next to the shim (see assertNoGuardViolations).
// launchRecordPath (drift attach evidence, any provider): the shim appends
// each launch's cwd, probe flag and `--add-dir` values (drift-attach.mjs
// gateLaunchRecord; no other argv) before the guard runs.
export function writeGuardedShim({
  provider,
  path,
  realCli,
  model,
  effort,
  options = {},
  launchRecordPath,
  memoryRecordPath,
}) {
  const entry = MODULES[provider];
  if (!entry) throw new Error(`No gate guard for ${provider}`);
  assertApprovedGateModel({ provider, model, effort });
  for (const key of Object.keys(options ?? {}))
    if (!TRANSPORT_OPTIONS[provider].has(key))
      throw new Error(
        `Unsupported guarded shim option for ${provider}: ${key}`,
      );
  if (
    provider === "codex" &&
    options.execTransport !== undefined &&
    options.execTransport !== "codex-exec/v1"
  )
    throw new Error("Unsupported Codex exec transport");
  // A guarded serve without them refuses to start (withCompactionOptions).
  const compaction = options?.compactionOptions;
  if (
    provider === "opencode" &&
    (typeof compaction !== "object" ||
      compaction === null ||
      !Object.keys(compaction).length)
  )
    throw new Error("An OpenCode shim needs compaction reasoning options");
  const [module, fn] = entry;
  const href = new URL(module, import.meta.url).href;
  const approved =
    provider === "codex"
      ? {
          model,
          effort,
          ...options,
          ...(options.execTransport === undefined
            ? {}
            : { violationRecordPath: guardViolationPath(path) }),
        }
      : { model, effort };
  // Validate exactly what the shim will pass to the guard.
  assertApprovedGateModel({
    provider,
    model: approved.model,
    effort: approved.effort,
  });
  const shimOptions =
    provider === "claude"
      ? { ...options, violationRecordPath: guardViolationPath(path) }
      : options;
  const extra =
    provider === "claude" || provider === "opencode"
      ? `, ${JSON.stringify(shimOptions)}`
      : "";
  const record =
    launchRecordPath === undefined
      ? ""
      : `import {appendGateLaunchRecord} from ${JSON.stringify(new URL("./drift-attach.mjs", import.meta.url).href)};\nappendGateLaunchRecord(${JSON.stringify(launchRecordPath)});\n`;
  const memoryRecord =
    memoryRecordPath === undefined
      ? ""
      : `import {appendMultiLaunchEvidence} from ${JSON.stringify(new URL("./multi-launch-evidence.mjs", import.meta.url).href)};\nappendMultiLaunchEvidence(${JSON.stringify(memoryRecordPath)},${JSON.stringify(provider)},${JSON.stringify(realCli)});\n`;
  writeFileSync(
    path,
    `#!/usr/bin/env node\nimport {${fn}} from ${JSON.stringify(href)};\n${record}${memoryRecord}await ${fn}(${JSON.stringify(realCli)}, ${JSON.stringify(approved)}${extra});\n`,
    { mode: 0o700 },
  );
  return path;
}
