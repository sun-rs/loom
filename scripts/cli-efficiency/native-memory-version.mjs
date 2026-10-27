import { execFileSync } from "node:child_process";
import { isAbsolute } from "node:path";
// Bounded source audits, not invented disable switches. An upgrade requires review.
export const NATIVE_MEMORY_VERSION_AUDITS = Object.freeze({
  kimi: Object.freeze({
    version: "2.1.1",
    sourceRevision:
      "installed-bundle-sha256:2563a338c94868a34e1bfd2e5579067d5a472acf4cb0bf350a3bfe1092bbe59d",
  }),
  opencode: Object.freeze({
    version: "1.19.4",
    sourceRevision: "148842ef7cb1bc34192b3fff57d0f9721ab9c801",
  }),
});
// Historical exact-version evidence remains verifiable; this is not a semver range.
const PREVIOUS_KIMI_AUDIT = Object.freeze({
  version: "0.39.1",
  sourceRevision: "5efca0c3116743855c28426000073bfe34a4862f",
});
const OPENCODE_11835_AUDIT = Object.freeze({
  version: "1.18.35",
  sourceRevision: "53d1eabb61e21162157817bf677da0a4ad3332e3",
});
const PREVIOUS_OPENCODE_AUDIT = Object.freeze({
  version: "1.18.32",
  sourceRevision: "545f51d26cc39a907d2867492d498d9607ea5fa4",
});
export function nativeMemoryAuditForVersion(provider, version) {
  const current = NATIVE_MEMORY_VERSION_AUDITS[provider];
  if (current?.version === version) return current;
  if (provider === "kimi" && version === PREVIOUS_KIMI_AUDIT.version)
    return PREVIOUS_KIMI_AUDIT;
  if (provider === "opencode" && version === OPENCODE_11835_AUDIT.version)
    return OPENCODE_11835_AUDIT;
  if (provider === "opencode" && version === PREVIOUS_OPENCODE_AUDIT.version)
    return PREVIOUS_OPENCODE_AUDIT;
}
export function nativeMemoryVersionEvidence({
  provider,
  executable,
  args,
  env,
}) {
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
  const audit = nativeMemoryAuditForVersion(provider, version);
  if (!audit)
    throw new Error(
      `No audited native auto-memory policy for ${provider} version ${version.slice(0, 80)}`,
    );
  return {
    ...audit,
    status: "not-applicable",
    evidence: "audited-cli-version",
  };
}
