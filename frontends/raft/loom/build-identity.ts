// The Web shell reports the product identity injected by its build. Vite
// replaces `__RAH_BUILD_IDENTITY__` with a literal JSON payload, so the bundle
// carries its own identity and does not ask the daemon or the Git tree for one.
// Without an injected identity this is a development bundle and says so.

export type WebBuildIdentityKind = "development" | "release";

export type WebBuildIdentity = {
  schemaVersion: 1;
  kind: WebBuildIdentityKind;
  version: string;
  releaseVersion?: string;
  commit?: string;
  shortCommit?: string;
  builtAt?: string;
  buildId: string;
};

declare const __RAH_BUILD_IDENTITY__: string | undefined;

const RELEASE_VERSION =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const COMMIT = /^[0-9a-f]{7,64}$/u;
const BUILD_ID = /^[0-9a-z]{1,64}$/u;

const DEVELOPMENT_IDENTITY: WebBuildIdentity = Object.freeze({
  schemaVersion: 1,
  kind: "development",
  version: "0.0.0-dev+local",
  buildId: "development",
});

export function parseWebBuildIdentity(
  raw: string | undefined,
): WebBuildIdentity {
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

export function buildIdentityLabel(identity: WebBuildIdentity): string {
  return `RAH OS ${identity.version}`;
}

/**
 * The copyable acceptance line under the version. `buildId` is always shown:
 * it is the value an operator compares against `/_rah/health` to prove the Web
 * bundle and the running Core are one build. Commit and build time follow when
 * the build recorded them.
 */
export function buildIdentityDetail(identity: WebBuildIdentity): string {
  const builtAt =
    identity.builtAt === undefined
      ? undefined
      : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u.exec(identity.builtAt)?.[0];
  return [
    `构建 ${identity.buildId}`,
    ...(identity.shortCommit === undefined
      ? []
      : [`提交 ${identity.shortCommit}`]),
    ...(builtAt === undefined ? [] : [`${builtAt}Z`]),
  ].join(" · ");
}

export const WEB_BUILD_IDENTITY: WebBuildIdentity = parseWebBuildIdentity(
  typeof __RAH_BUILD_IDENTITY__ === "string"
    ? __RAH_BUILD_IDENTITY__
    : undefined,
);
