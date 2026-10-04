import { execFileSync } from "node:child_process";
import { isAbsolute } from "node:path";
// Bounded source audits, not invented disable switches. An upgrade requires review.
export const NATIVE_MEMORY_VERSION_AUDITS = Object.freeze({
  kimi: Object.freeze({
    version: "0.39.1",
    sourceRevision: "5efca0c3116743855c28426000073bfe34a4862f",
  }),
  opencode: Object.freeze({
    version: "1.18.32",
    sourceRevision: "545f51d26cc39a907d2867492d498d9607ea5fa4",
  }),
});
export function nativeMemoryVersionEvidence({
  provider,
  executable,
  args,
  env,
}) {
  const audit = NATIVE_MEMORY_VERSION_AUDITS[provider];
  if (typeof executable !== "string" || !isAbsolute(executable))
    throw new Error(
      "Native memory audit requires the actual absolute executable",
    );
  if (
    provider === "opencode" &&
    (args[0] !== "run" ||
      !args.includes("--pure") ||
      env.OPENCODE_DISABLE_CLAUDE_CODE !== "1" ||
      env.OPENCODE_DISABLE_EXTERNAL_SKILLS !== "1")
  )
    throw new Error(
      "OpenCode audited native launch requires --pure and product instruction isolation",
    );
  let version;
  try {
    version = execFileSync(executable, ["--version"], {
      env,
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 8192,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error("Native audited CLI version could not be verified");
  }
  if (version !== audit?.version)
    throw new Error(
      `No audited native auto-memory policy for ${provider} version ${version.slice(0, 80)}`,
    );
  return {
    ...audit,
    status: "not-applicable",
    evidence: "audited-cli-version",
  };
}
