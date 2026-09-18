// The daemon reports the product identity frozen into it at build time. The
// packaging step replaces `process.env.RAH_OS_BUILD_IDENTITY` with a literal,
// so a shipped Core never depends on a Git working tree or on the environment
// of whoever started it. Without an injected identity this is a development
// build and says so; it never claims a signed release version.
//
// Schema, protocol and runtime binding versions are separate and are not
// derived from this identity.

export type DaemonBuildIdentityKind = "development" | "release";

export type DaemonBuildIdentity = {
  schemaVersion: 1;
  kind: DaemonBuildIdentityKind;
  version: string;
  releaseVersion?: string;
  commit?: string;
  shortCommit?: string;
  builtAt?: string;
  buildId: string;
};

const RELEASE_VERSION =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const COMMIT = /^[0-9a-f]{7,64}$/u;
const BUILD_ID = /^[0-9a-z]{1,64}$/u;

const DEVELOPMENT_IDENTITY: DaemonBuildIdentity = Object.freeze({
  schemaVersion: 1,
  kind: "development",
  version: "0.0.0-dev+local",
  buildId: "development",
});

export function resolveDaemonBuildIdentity(
  environment?: Readonly<Record<string, string | undefined>>,
): DaemonBuildIdentity {
  const raw =
    environment === undefined
      ? process.env.RAH_OS_BUILD_IDENTITY
      : environment.RAH_OS_BUILD_IDENTITY;
  return parseDaemonBuildIdentity(raw);
}

export function parseDaemonBuildIdentity(
  raw: string | undefined,
): DaemonBuildIdentity {
  if (typeof raw !== "string" || raw.trim() === "") return DEVELOPMENT_IDENTITY;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEVELOPMENT_IDENTITY;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return DEVELOPMENT_IDENTITY;
  }
  const record = value as Record<string, unknown>;
  const kind = record["kind"];
  const version = record["version"];
  const buildId = record["buildId"];
  const releaseVersion = record["releaseVersion"];
  const commit = record["commit"];
  const builtAt = record["builtAt"];
  if (
    record["schemaVersion"] !== 1 ||
    (kind !== "release" && kind !== "development") ||
    typeof version !== "string" ||
    version === "" ||
    typeof buildId !== "string" ||
    !BUILD_ID.test(buildId)
  ) {
    return DEVELOPMENT_IDENTITY;
  }
  if (
    kind === "release" &&
    (typeof releaseVersion !== "string" ||
      !RELEASE_VERSION.test(releaseVersion))
  ) {
    return DEVELOPMENT_IDENTITY;
  }
  if (kind === "development" && releaseVersion !== undefined) {
    return DEVELOPMENT_IDENTITY;
  }
  if (
    commit !== undefined &&
    (typeof commit !== "string" || !COMMIT.test(commit))
  ) {
    return DEVELOPMENT_IDENTITY;
  }
  return Object.freeze({
    schemaVersion: 1,
    kind,
    version,
    ...(kind === "release" ? { releaseVersion: releaseVersion as string } : {}),
    ...(typeof commit === "string"
      ? { commit, shortCommit: commit.slice(0, 7) }
      : {}),
    ...(typeof builtAt === "string" ? { builtAt } : {}),
    buildId,
  });
}

export function formatDaemonBuildIdentity(
  identity: DaemonBuildIdentity,
): string {
  return `RAH OS ${identity.version}`;
}
