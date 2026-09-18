// One release identity for the whole product. The release version is an
// explicit build input; commit and build time are frozen into the artefact at
// build time. Nothing here reads a Git working tree, so a shipped artefact can
// never report an identity that depends on where it happens to run.
//
// Schema (`KERNEL_SCHEMA_VERSION`), protocol versions and runtime binding
// versions stay independent of this identity and are not derived from it.

import { createHash } from "node:crypto";

export const BUILD_IDENTITY_SCHEMA_VERSION = 1;
export const BUILD_IDENTITY_ENVIRONMENT_KEY = "RAH_OS_BUILD_IDENTITY";
export const BUILD_IDENTITY_META_NAME = "rah-build-identity";
export const DEVELOPMENT_RELEASE_VERSION_PREFIX = "0.0.0-dev+";

const RELEASE_VERSION =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const PLACEHOLDER_RELEASE_VERSIONS = new Set(["0.0.0", "0.0.0-0"]);
const COMMIT = /^[0-9a-f]{7,64}$/u;
const BUILD_ID = /^[0-9a-z]{1,64}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;

/**
 * Resolve the single product identity from explicit build inputs.
 *
 * `mode: "formal"` is the shipping path and refuses to continue without a
 * release version instead of quietly falling back to `0.0.0`. Any other mode
 * (including an absent one) produces a development identity that still starts
 * but never looks like a signed release.
 */
export function resolveBuildIdentity(input = {}) {
  const mode = input.mode ?? "development";
  if (mode !== "formal" && mode !== "development") {
    throw new Error(`build mode is invalid: ${String(mode)}`);
  }
  const commit = optionalCommit(input.commit);
  const builtAt = timestamp(input.builtAt);
  if (mode === "development") {
    if (
      input.releaseVersion !== undefined &&
      String(input.releaseVersion).trim() !== ""
    ) {
      throw new Error(
        "a development build must not carry a release version; build with mode formal to ship one",
      );
    }
    return identity({
      kind: "development",
      version: `${DEVELOPMENT_RELEASE_VERSION_PREFIX}${
        commit === undefined ? "local" : commit.slice(0, 7)
      }`,
      commit,
      builtAt,
    });
  }
  const releaseVersion = requiredReleaseVersion(input.releaseVersion);
  return identity({
    kind: "release",
    version: releaseVersion,
    releaseVersion,
    commit,
    builtAt,
  });
}

/** Read the identity back out of an injected JSON payload. */
export function parseBuildIdentity(raw) {
  const decoded = decodeBuildIdentity(raw);
  return decoded ?? resolveBuildIdentity({ mode: "development" });
}

/** Environment a build step passes to the Web and daemon builds. */
export function buildIdentityEnvironment(value) {
  return Object.freeze({
    [BUILD_IDENTITY_ENVIRONMENT_KEY]: JSON.stringify(value),
  });
}

/** Base64 payload embedded in `index.html` so a product build can verify it. */
export function encodeBuildIdentityMeta(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function decodeBuildIdentityMeta(encoded) {
  if (typeof encoded !== "string" || !/^[A-Za-z0-9+/=]+$/u.test(encoded)) {
    return undefined;
  }
  return decodeBuildIdentity(Buffer.from(encoded, "base64").toString("utf8"));
}

/** Exact identity equality: same release version is not the same artefact. */
export function canonicalBuildIdentity(value) {
  return JSON.stringify([
    value.schemaVersion,
    value.kind,
    value.version,
    value.releaseVersion ?? null,
    value.commit ?? null,
    value.builtAt ?? null,
    value.buildId,
  ]);
}

export function buildIdentitiesAgree(left, right) {
  return canonicalBuildIdentity(left) === canonicalBuildIdentity(right);
}

/**
 * Environment the workbench launcher must give the daemon so that the running
 * Core reports the identity of the Web bundle it is actually serving. An
 * identity already in the environment wins but must agree with the bundle;
 * a disagreement is a fail-closed diagnostic, never a silent relabel.
 */
export function workbenchDaemonIdentityEnvironment(input) {
  const existing = decodeBuildIdentity(
    input.environment?.[BUILD_IDENTITY_ENVIRONMENT_KEY],
  );
  const bundle = input.bundleIdentity;
  if (existing !== undefined) {
    if (bundle !== undefined && !buildIdentitiesAgree(existing, bundle)) {
      throw new Error(
        `${BUILD_IDENTITY_ENVIRONMENT_KEY} is ${existing.version} (build ${existing.buildId}) but the Web bundle being served is ${bundle.version} (build ${bundle.buildId}); rebuild the Web bundle with this identity or unset the variable`,
      );
    }
    return Object.freeze({});
  }
  if (bundle === undefined) return Object.freeze({});
  return Object.freeze({
    [BUILD_IDENTITY_ENVIRONMENT_KEY]: JSON.stringify(bundle),
  });
}

export function formatBuildIdentityLabel(value) {
  return `RAH OS ${value.version}`;
}

/**
 * Build inputs an operator supplies through the environment. Absent inputs mean
 * a development build; they never silently produce a release identity.
 */
export function buildIdentityInputsFromEnvironment(environment = {}) {
  const releaseVersion = environment.RAH_OS_RELEASE_VERSION;
  const commit = environment.RAH_OS_BUILD_COMMIT;
  const builtAt = environment.RAH_OS_BUILD_TIMESTAMP;
  const declared =
    releaseVersion !== undefined && String(releaseVersion).trim() !== "";
  return Object.freeze({
    mode: declared ? "formal" : "development",
    ...(declared ? { releaseVersion } : {}),
    ...(commit === undefined || commit === "" ? {} : { commit }),
    ...(builtAt === undefined || builtAt === "" ? {} : { builtAt }),
  });
}

/**
 * The identity a build step should use: an already-resolved identity injected
 * by a parent build wins, so every entry point of one formal build agrees.
 */
export function buildIdentityForEnvironment(environment = {}) {
  const injected = decodeBuildIdentity(
    environment[BUILD_IDENTITY_ENVIRONMENT_KEY],
  );
  if (injected !== undefined) return injected;
  return resolveBuildIdentity(buildIdentityInputsFromEnvironment(environment));
}

function decodeBuildIdentity(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  if (
    value.schemaVersion !== BUILD_IDENTITY_SCHEMA_VERSION ||
    (value.kind !== "release" && value.kind !== "development") ||
    typeof value.version !== "string" ||
    value.version === "" ||
    typeof value.buildId !== "string" ||
    !BUILD_ID.test(value.buildId)
  ) {
    return undefined;
  }
  if (value.kind === "release" && !RELEASE_VERSION.test(value.releaseVersion)) {
    return undefined;
  }
  if (value.kind === "development" && value.releaseVersion !== undefined) {
    return undefined;
  }
  if (value.commit !== undefined && !COMMIT.test(value.commit)) {
    return undefined;
  }
  return Object.freeze({
    schemaVersion: BUILD_IDENTITY_SCHEMA_VERSION,
    kind: value.kind,
    version: value.version,
    ...(value.kind === "release"
      ? { releaseVersion: value.releaseVersion }
      : {}),
    ...(value.commit === undefined
      ? {}
      : { commit: value.commit, shortCommit: value.commit.slice(0, 7) }),
    ...(typeof value.builtAt === "string" ? { builtAt: value.builtAt } : {}),
    buildId: value.buildId,
  });
}

function identity(input) {
  const buildId = createHash("sha256")
    .update(
      JSON.stringify([
        input.kind,
        input.version,
        input.releaseVersion ?? null,
        input.commit ?? null,
        input.builtAt,
      ]),
    )
    .digest("hex")
    .slice(0, 16);
  return Object.freeze({
    schemaVersion: BUILD_IDENTITY_SCHEMA_VERSION,
    kind: input.kind,
    version: input.version,
    ...(input.releaseVersion === undefined
      ? {}
      : { releaseVersion: input.releaseVersion }),
    ...(input.commit === undefined
      ? {}
      : { commit: input.commit, shortCommit: input.commit.slice(0, 7) }),
    builtAt: input.builtAt,
    buildId,
  });
}

function requiredReleaseVersion(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      "a formal build release version is required; refusing to fall back to 0.0.0",
    );
  }
  const trimmed = value.trim();
  if (!RELEASE_VERSION.test(trimmed)) {
    throw new Error(`release version is invalid: ${trimmed}`);
  }
  if (PLACEHOLDER_RELEASE_VERSIONS.has(trimmed)) {
    throw new Error(
      `release version ${trimmed} is a placeholder, not a decided product version`,
    );
  }
  return trimmed;
}

function optionalCommit(value) {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !COMMIT.test(value)) {
    throw new Error("build commit must be a hexadecimal commit id");
  }
  return value;
}

function timestamp(value) {
  if (value === undefined) return new Date().toISOString();
  if (typeof value !== "string" || !TIMESTAMP.test(value)) {
    throw new Error("build timestamp must be an ISO-8601 UTC instant");
  }
  return value;
}

// `node scripts/release-version.mjs --release-version <v> [--commit <sha>]`
// prints the resolved identity so one shell can export it once and every build
// step of that release agrees byte for byte.
if (
  process.argv[1] !== undefined &&
  process.argv[1].endsWith("release-version.mjs")
) {
  const parsed = new Map();
  const values = process.argv.slice(2);
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (
      (key !== "--release-version" &&
        key !== "--commit" &&
        key !== "--built-at") ||
      value === undefined ||
      parsed.has(key)
    ) {
      throw new Error(
        "usage: release-version --release-version <version> [--commit <sha>] [--built-at <iso8601>]",
      );
    }
    parsed.set(key, value);
  }
  process.stdout.write(
    `${JSON.stringify(
      resolveBuildIdentity({
        mode: parsed.has("--release-version") ? "formal" : "development",
        ...(parsed.has("--release-version")
          ? { releaseVersion: parsed.get("--release-version") }
          : {}),
        ...(parsed.has("--commit") ? { commit: parsed.get("--commit") } : {}),
        ...(parsed.has("--built-at")
          ? { builtAt: parsed.get("--built-at") }
          : {}),
      }),
    )}\n`,
  );
}
