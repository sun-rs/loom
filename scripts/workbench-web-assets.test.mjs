import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BUILD_IDENTITY_META_NAME,
  encodeBuildIdentityMeta,
  resolveBuildIdentity,
} from "./release-version.mjs";
import {
  readWorkbenchAssetIdentity,
  snapshotWorkbenchAssets,
} from "./workbench-web-assets.mjs";

const identity = resolveBuildIdentity({
  mode: "development",
  builtAt: "2026-09-16T00:00:00.000Z",
});
const otherIdentity = resolveBuildIdentity({
  mode: "development",
  builtAt: "2026-09-16T00:00:01.000Z",
});

test("a development bundle carries one identity that the launcher can read back", async () => {
  await withBundle(
    { indexIdentity: identity, metadataIdentity: identity },
    async ({ repositoryDirectory, buildDirectory }) => {
      const snapshot = await snapshotWorkbenchAssets(
        repositoryDirectory,
        buildDirectory,
      );
      const read = await readWorkbenchAssetIdentity(snapshot);

      assert.equal(read.kind, "development");
      assert.equal(read.version, "0.0.0-dev+local");
      assert.equal(read.buildId, identity.buildId);
      assert.notEqual(read.buildId, "development");
    },
  );
});

test("a bundle whose two identity records disagree is refused, not relabelled", async () => {
  await withBundle(
    { indexIdentity: identity, metadataIdentity: otherIdentity },
    async ({ repositoryDirectory, buildDirectory }) => {
      assert.equal(identity.version, otherIdentity.version);
      assert.notEqual(identity.buildId, otherIdentity.buildId);
      await assert.rejects(
        snapshotWorkbenchAssets(repositoryDirectory, buildDirectory),
        /Product Web build identity disagrees/u,
      );
    },
  );
});

test("a bundle that declares its identity in only one place is refused", async () => {
  for (const half of [
    { indexIdentity: identity },
    { metadataIdentity: identity },
  ]) {
    await withBundle(half, async ({ repositoryDirectory, buildDirectory }) => {
      await assert.rejects(
        snapshotWorkbenchAssets(repositoryDirectory, buildDirectory),
        /declares its release identity in only one place/u,
      );
    });
  }
});

test("a bundle with no identity at all still snapshots and reports none", async () => {
  await withBundle({}, async ({ repositoryDirectory, buildDirectory }) => {
    const snapshot = await snapshotWorkbenchAssets(
      repositoryDirectory,
      buildDirectory,
    );
    assert.equal(await readWorkbenchAssetIdentity(snapshot), undefined);
  });
});

async function withBundle(input, body) {
  const root = mkdtempSync(join(tmpdir(), "rah-workbench-assets-"));
  try {
    const buildDirectory = join(root, "build");
    mkdirSync(buildDirectory, { recursive: true });
    const meta =
      input.indexIdentity === undefined
        ? ""
        : `<meta name="${BUILD_IDENTITY_META_NAME}" content="${encodeBuildIdentityMeta(input.indexIdentity)}">`;
    writeFileSync(
      join(buildDirectory, "index.html"),
      `<!doctype html><head><meta name="rah-web-build-id" content="web-generation-test">${meta}</head><div id="root">RAH OS</div>`,
    );
    writeFileSync(
      join(buildDirectory, ".rah-web-build.json"),
      JSON.stringify({
        ...(input.metadataIdentity === undefined
          ? {}
          : { buildIdentity: input.metadataIdentity }),
        schemaVersion: 1,
        webBuildId: "web-generation-test",
      }),
    );
    await body({ repositoryDirectory: root, buildDirectory });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}
