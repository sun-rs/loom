import assert from "node:assert/strict";
import test from "node:test";

import {
  WEB_BUILD_IDENTITY,
  buildIdentityDetail,
  buildIdentityLabel,
  parseWebBuildIdentity,
} from "../src/build-identity.ts";
import { readUiSource } from "./ui-source.ts";

const releaseIdentity = JSON.stringify({
  schemaVersion: 1,
  kind: "release",
  version: "9.9.9",
  releaseVersion: "9.9.9",
  commit: "0123456789abcdef0123456789abcdef01234567",
  shortCommit: "0123456",
  builtAt: "2026-09-16T00:00:00.000Z",
  buildId: "00112233445566aa",
});

test("the Web shell reads the identity injected by the build", () => {
  const identity = parseWebBuildIdentity(releaseIdentity);

  assert.equal(identity.kind, "release");
  assert.equal(identity.version, "9.9.9");
  assert.equal(buildIdentityLabel(identity), "RAH OS 9.9.9");
});

test("a Web bundle built without an injected identity is labelled development", () => {
  const identity = parseWebBuildIdentity(undefined);

  assert.equal(identity.kind, "development");
  assert.match(identity.version, /^0\.0\.0-dev\+/u);
  assert.notEqual(identity.version, "0.0.0");
  assert.equal(WEB_BUILD_IDENTITY.kind, "development");
});

test("the build line is copyable acceptance evidence, not a decoration", () => {
  // buildId is always present: it is the value compared against /_rah/health.
  assert.equal(
    buildIdentityDetail(parseWebBuildIdentity(undefined)),
    "构建 development",
  );
  assert.equal(
    buildIdentityDetail(parseWebBuildIdentity(releaseIdentity)),
    "构建 00112233445566aa · 提交 0123456 · 2026-09-16T00:00:00Z",
  );
  // A development bundle built without a commit still shows its build id and time.
  assert.equal(
    buildIdentityDetail({
      schemaVersion: 1,
      kind: "development",
      version: "0.0.0-dev+local",
      builtAt: "2026-09-16T14:05:45.912Z",
      buildId: "9c1fec793a093a5b",
    }),
    "构建 9c1fec793a093a5b · 2026-09-16T14:05:45Z",
  );
  // An unusable build time is dropped rather than rendered as noise.
  assert.equal(
    buildIdentityDetail({
      schemaVersion: 1,
      kind: "development",
      version: "0.0.0-dev+local",
      builtAt: "not a time",
      buildId: "9c1fec793a093a5b",
    }),
    "构建 9c1fec793a093a5b",
  );
});

test("Settings 关于 renders the injected identity instead of a hardcoded version", () => {
  const source = readUiSource("components/settings-pages.tsx");

  assert.ok(
    !source.includes("RAH OS 0.0.0"),
    "settings-pages.tsx must not hardcode a product version",
  );
  assert.ok(
    !/\b0\.0\.0\b/u.test(source),
    "settings-pages.tsx must carry no literal product version",
  );
  assert.match(source, /build-identity\.ts/u);
  assert.match(source, /buildIdentityLabel/u);
  assert.match(source, /kind === "development"/u);
  // The acceptance line must be rendered, not only computable.
  assert.match(source, /buildIdentityDetail\(WEB_BUILD_IDENTITY\)/u);
});
