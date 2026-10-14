import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  BUILD_IDENTITY_META_NAME,
  DEVELOPMENT_RELEASE_VERSION_PREFIX,
  buildIdentityEnvironment,
  formatBuildIdentityLabel,
  encodeBuildIdentityMeta,
  parseBuildIdentity,
  resolveBuildIdentity,
  workbenchDaemonIdentityEnvironment,
} from "./release-version.mjs";

// Exactly how Vite injects the identity into the product index.html.
function indexHtml(identity) {
  return `<head><meta name="rah-web-build-id" content="abc"><meta name="${BUILD_IDENTITY_META_NAME}" content="${encodeBuildIdentityMeta(identity)}"></head>`;
}

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));

test("a formal build resolves one identity from explicit inputs", () => {
  const identity = resolveBuildIdentity({
    mode: "formal",
    releaseVersion: "1.2.3",
    commit: "0123456789abcdef0123456789abcdef01234567",
    builtAt: "2026-09-16T00:00:00.000Z",
  });

  assert.equal(identity.kind, "release");
  assert.equal(identity.version, "1.2.3");
  assert.equal(identity.releaseVersion, "1.2.3");
  assert.equal(identity.commit, "0123456789abcdef0123456789abcdef01234567");
  assert.equal(identity.shortCommit, "0123456");
  assert.equal(identity.builtAt, "2026-09-16T00:00:00.000Z");
  assert.match(identity.buildId, /^[0-9a-f]{16}$/u);
});

test("the same explicit inputs always produce the same build id", () => {
  const inputs = {
    mode: "formal",
    releaseVersion: "1.2.3",
    commit: "0123456789abcdef0123456789abcdef01234567",
    builtAt: "2026-09-16T00:00:00.000Z",
  };

  assert.equal(
    resolveBuildIdentity(inputs).buildId,
    resolveBuildIdentity(inputs).buildId,
  );
  assert.notEqual(
    resolveBuildIdentity(inputs).buildId,
    resolveBuildIdentity({ ...inputs, releaseVersion: "1.2.4" }).buildId,
  );
});

test("a formal build without a release version is refused instead of falling back", () => {
  assert.throws(
    () =>
      resolveBuildIdentity({
        mode: "formal",
        builtAt: "2026-09-16T00:00:00.000Z",
      }),
    /release version is required/u,
  );
  assert.throws(
    () =>
      resolveBuildIdentity({
        mode: "formal",
        releaseVersion: "",
        builtAt: "2026-09-16T00:00:00.000Z",
      }),
    /release version is required/u,
  );
  assert.throws(
    () =>
      resolveBuildIdentity({
        mode: "formal",
        releaseVersion: "0.0.0",
        builtAt: "2026-09-16T00:00:00.000Z",
      }),
    /placeholder/u,
  );
  assert.throws(
    () =>
      resolveBuildIdentity({
        mode: "formal",
        releaseVersion: "not a version",
        builtAt: "2026-09-16T00:00:00.000Z",
      }),
    /release version is invalid/u,
  );
});

test("a development build stays startable and is labelled development", () => {
  const withCommit = resolveBuildIdentity({
    mode: "development",
    commit: "0123456789abcdef0123456789abcdef01234567",
    builtAt: "2026-09-16T00:00:00.000Z",
  });
  assert.equal(withCommit.kind, "development");
  assert.equal(withCommit.releaseVersion, undefined);
  assert.equal(withCommit.version, "0.0.0-dev+0123456");
  assert.ok(withCommit.version.startsWith(DEVELOPMENT_RELEASE_VERSION_PREFIX));

  const withoutCommit = resolveBuildIdentity({
    mode: "development",
    builtAt: "2026-09-16T00:00:00.000Z",
  });
  assert.equal(withoutCommit.version, "0.0.0-dev+local");
  assert.equal(withoutCommit.commit, undefined);
});

test("an absent mode with no release version means development, never a signed release", () => {
  const identity = resolveBuildIdentity({
    builtAt: "2026-09-16T00:00:00.000Z",
  });
  assert.equal(identity.kind, "development");
  assert.notEqual(identity.version, "0.0.0");
  assert.equal(formatBuildIdentityLabel(identity), "RAH OS 0.0.0-dev+local");
});

test("a development identity never claims a release version it was not given", () => {
  assert.throws(
    () =>
      resolveBuildIdentity({
        mode: "development",
        releaseVersion: "1.2.3",
        builtAt: "2026-09-16T00:00:00.000Z",
      }),
    /development build must not carry a release version/u,
  );
});

test("the identity round-trips through the injected environment", () => {
  const identity = resolveBuildIdentity({
    mode: "formal",
    releaseVersion: "1.2.3",
    commit: "0123456789abcdef0123456789abcdef01234567",
    builtAt: "2026-09-16T00:00:00.000Z",
  });
  const environment = buildIdentityEnvironment(identity);

  assert.deepEqual(
    parseBuildIdentity(environment.RAH_OS_BUILD_IDENTITY),
    identity,
  );
});

test("an absent or unusable injected identity degrades to a development identity", () => {
  assert.equal(parseBuildIdentity(undefined).kind, "development");
  assert.equal(parseBuildIdentity("").kind, "development");
  assert.equal(parseBuildIdentity("{not json").kind, "development");
  assert.equal(parseBuildIdentity('{"kind":"release"}').kind, "development");
});

test("release identity resolution never shells out to git at build or run time", () => {
  for (const relativePath of [
    "release-version.mjs",
    "../packages/daemon/src/build-identity.ts",
    "../frontends/raft/loom/build-identity.ts",
  ]) {
    const source = readFileSync(join(scriptsDirectory, relativePath), "utf8");
    for (const forbidden of [
      "node:child_process",
      "execFile",
      "spawnSync",
      "rev-parse",
    ]) {
      assert.ok(
        !source.includes(forbidden),
        `${relativePath} must not reach for ${forbidden}; commit comes from an explicit build input`,
      );
    }
  }
});

test("the development identity is deterministic for the same build inputs", () => {
  const inputs = { mode: "development", builtAt: "2026-09-16T00:00:00.000Z" };

  assert.equal(
    resolveBuildIdentity(inputs).buildId,
    resolveBuildIdentity(inputs).buildId,
  );
  assert.notEqual(
    resolveBuildIdentity(inputs).buildId,
    resolveBuildIdentity({ ...inputs, builtAt: "2026-09-16T00:00:01.000Z" })
      .buildId,
  );
  // A development build is still a specific artefact, not a constant label.
  assert.match(resolveBuildIdentity(inputs).buildId, /^[0-9a-f]{16}$/u);
  assert.notEqual(resolveBuildIdentity(inputs).buildId, "development");
});

test("the workbench launcher hands the served bundle's identity to the daemon", () => {
  const bundle = resolveBuildIdentity({
    mode: "development",
    builtAt: "2026-09-16T00:00:00.000Z",
  });

  // No identity in the environment: adopt the bundle's, so health and Settings
  // agree in development too.
  assert.deepEqual(
    workbenchDaemonIdentityEnvironment({
      bundleIdentity: bundle,
      environment: {},
    }),
    { RAH_OS_BUILD_IDENTITY: JSON.stringify(bundle) },
  );

  // Already set and in agreement: leave it alone.
  assert.deepEqual(
    workbenchDaemonIdentityEnvironment({
      bundleIdentity: bundle,
      environment: { RAH_OS_BUILD_IDENTITY: JSON.stringify(bundle) },
    }),
    {},
  );

  // Already set and in disagreement: fail closed with a diagnostic instead of
  // serving one build while reporting another.
  const other = resolveBuildIdentity({
    mode: "development",
    builtAt: "2026-09-16T00:00:01.000Z",
  });
  assert.throws(
    () =>
      workbenchDaemonIdentityEnvironment({
        bundleIdentity: bundle,
        environment: { RAH_OS_BUILD_IDENTITY: JSON.stringify(other) },
      }),
    /but the Web bundle being served is/u,
  );

  // A bundle without an identity cannot invent one.
  assert.deepEqual(workbenchDaemonIdentityEnvironment({ environment: {} }), {});
});

test("the product build refuses a formal build without a release version", () => {
  const result = spawnSync(
    process.execPath,
    [
      join(scriptsDirectory, "build-local-core-product.mjs"),
      "--output",
      join(tmpdir(), "rah-os-release-version-refusal"),
    ],
    { encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--version/u);
});

test("the product build rejects a Web bundle that is not this exact artefact", async () => {
  const { assertWebBuildIdentity } =
    await import("./build-local-core-product.mjs");
  const core = resolveBuildIdentity({
    mode: "formal",
    releaseVersion: "1.2.3",
    commit: "0123456789abcdef0123456789abcdef01234567",
    builtAt: "2026-09-16T00:00:00.000Z",
  });
  // Same release version and same commit, built a second later: a different
  // artefact, and it must not be packaged as this one.
  const rebuilt = resolveBuildIdentity({
    mode: "formal",
    releaseVersion: "1.2.3",
    commit: "0123456789abcdef0123456789abcdef01234567",
    builtAt: "2026-09-16T00:00:01.000Z",
  });
  const development = resolveBuildIdentity({
    mode: "development",
    commit: "0123456789abcdef0123456789abcdef01234567",
    builtAt: "2026-09-16T00:00:00.000Z",
  });

  assert.notEqual(core.buildId, rebuilt.buildId);
  assert.equal(core.version, rebuilt.version);
  assert.equal(core.commit, rebuilt.commit);

  // The matching pair is accepted.
  assertWebBuildIdentity(indexHtml(core), core);

  assert.throws(
    () => assertWebBuildIdentity(indexHtml(rebuilt), core),
    /does not match the Core identity/u,
  );
  assert.throws(
    () => assertWebBuildIdentity(indexHtml(development), core),
    /development bundle/u,
  );
  assert.throws(
    () => assertWebBuildIdentity("<head></head>", core),
    /carries no release identity/u,
  );
  assert.throws(
    () =>
      assertWebBuildIdentity(
        `<head><meta name="${BUILD_IDENTITY_META_NAME}" content="bm90LWFuLWlkZW50aXR5"></head>`,
        core,
      ),
    /release identity is invalid/u,
  );
});

test("the product build hands the same identity to the Core bundle and the Web bundle", () => {
  const buildSource = readFileSync(
    join(scriptsDirectory, "build-local-core-product.mjs"),
    "utf8",
  );
  const viteSource = readFileSync(
    join(scriptsDirectory, "../frontends/raft/loom/release-plugin.ts"),
    "utf8",
  );

  // Core: the identity is frozen into the bundle, not read at start-up.
  assert.match(buildSource, /"process\.env\.RAH_OS_BUILD_IDENTITY"/u);
  assert.match(buildSource, /mode: "formal"/u);
  // Web: injected as a define and published as a verifiable meta tag.
  assert.match(viteSource, /__RAH_BUILD_IDENTITY__/u);
  assert.match(viteSource, /encodeBuildIdentityMeta/u);
  // The product build refuses a Web bundle whose identity is not this release.
  assert.match(buildSource, /assertWebBuildIdentity/u);
  assert.match(buildSource, /development bundle/u);
});

test("the workbench launcher applies the identity before the daemon is loaded", () => {
  const launcher = readFileSync(
    join(scriptsDirectory, "run-local-workbench.mjs"),
    "utf8",
  );

  // The daemon resolves its build identity once, at module load. A static
  // import of the daemon would be hoisted above the Object.assign, so the
  // launcher must load it dynamically afterwards. A unit test of the pure
  // function cannot catch this ordering hazard.
  assert.ok(
    !/^import[^\n]*@rah-os\/daemon/mu.test(launcher),
    "run-local-workbench.mjs must not statically import the daemon",
  );
  const applied = launcher.indexOf("workbenchDaemonIdentityEnvironment({");
  const loaded = launcher.search(/await import\(\s*"@rah-os\/daemon/u);
  assert.ok(applied > 0 && loaded > applied, launcher);
});
