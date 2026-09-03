import assert from "node:assert/strict";
import test from "node:test";
import {
  access,
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  utimes,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireWorkbenchAssetLease,
  pruneWorkbenchAssetSnapshots,
  snapshotWorkbenchAssets,
  webBuildOutput,
} from "../../../scripts/workbench-web-assets.mjs";

async function writeFixtureBuildIdentity(source: string) {
  const indexPath = join(source, "index.html");
  const index = await readFile(indexPath, "utf8");
  await writeFile(
    indexPath,
    `<meta name="rah-web-build-id" content="fixture-build">${index}`,
  );
  await writeFile(
    join(source, ".rah-web-build.json"),
    JSON.stringify({ schemaVersion: 1, webBuildId: "fixture-build" }),
  );
}

test("ordinary builds cannot overwrite the product output", () => {
  assert.equal(webBuildOutput(false), "dist");
  assert.equal(webBuildOutput(true), "dist-workbench");
});

test("a running source workbench keeps a frozen asset directory across subsequent builds", async () => {
  const root = await mkdtemp(join(tmpdir(), "rah-build-isolation-"));
  try {
    const source = join(root, "apps/web/dist-workbench");
    await mkdir(join(source, "assets"), { recursive: true });
    await writeFile(
      join(source, "index.html"),
      '<script src="/assets/a.js"></script>',
    );
    await writeFile(join(source, "assets/a.js"), "version one");
    await writeFixtureBuildIdentity(source);
    const first = await snapshotWorkbenchAssets(root);
    assert.equal(await snapshotWorkbenchAssets(root), first);
    await writeFile(join(source, "assets/a.js"), "version two");
    const second = await snapshotWorkbenchAssets(root);
    assert.notEqual(second, first);
    assert.equal(
      await snapshotWorkbenchAssets(root, first),
      first,
      "an installed release stays pinned, even when the build directory changes",
    );
    assert.equal(
      await readFile(join(first, "assets/a.js"), "utf8"),
      "version one",
    );
    assert.equal(
      await readFile(join(second, "assets/a.js"), "utf8"),
      "version two",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing product build fails closed instead of using a generic token build", async () => {
  const root = await mkdtemp(join(tmpdir(), "rah-build-missing-"));
  try {
    await assert.rejects(snapshotWorkbenchAssets(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an incomplete product build without generation metadata fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "rah-build-incomplete-"));
  try {
    const source = join(root, "apps/web/dist-workbench");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "index.html"), "<main>incomplete</main>");
    await assert.rejects(
      snapshotWorkbenchAssets(root),
      /Web build metadata is missing/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an entry point and generation manifest cannot disagree", async () => {
  const root = await mkdtemp(join(tmpdir(), "rah-build-mismatch-"));
  try {
    const source = join(root, "apps/web/dist-workbench");
    await mkdir(source, { recursive: true });
    await writeFile(
      join(source, "index.html"),
      '<meta name="rah-web-build-id" content="entry-generation">',
    );
    await writeFile(
      join(source, ".rah-web-build.json"),
      JSON.stringify({
        schemaVersion: 1,
        webBuildId: "manifest-generation",
      }),
    );
    await assert.rejects(
      snapshotWorkbenchAssets(root),
      /identity does not match/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("snapshot retention preserves live leases and only removes old superseded releases", async () => {
  const root = await mkdtemp(join(tmpdir(), "rah-build-retention-"));
  try {
    const source = join(root, "apps/web/dist-workbench");
    await mkdir(join(source, "assets"), { recursive: true });
    await writeFile(
      join(source, "index.html"),
      '<script src="/assets/a.js"></script>',
    );
    await writeFixtureBuildIdentity(source);
    const releases: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      await writeFile(join(source, "assets/a.js"), `version ${String(index)}`);
      const release = await snapshotWorkbenchAssets(root);
      releases.push(release);
      const timestamp = new Date(Date.UTC(2026, 0, 1, 0, index));
      await utimes(release, timestamp, timestamp);
    }

    const lease = await acquireWorkbenchAssetLease(root, releases[0]);
    const firstPrune = await pruneWorkbenchAssetSnapshots(root, {
      minimumAgeMs: 0,
      now: () => new Date(Date.UTC(2026, 0, 2)),
      retainRecent: 2,
    });
    assert.deepEqual(
      new Set(firstPrune.removedDirectories),
      new Set(releases.slice(1, 3)),
    );
    await access(releases[0]);
    await access(releases[3]);
    await access(releases[4]);

    await lease.release();
    const secondPrune = await pruneWorkbenchAssetSnapshots(root, {
      minimumAgeMs: 0,
      now: () => new Date(Date.UTC(2026, 0, 2)),
      retainRecent: 2,
    });
    assert.deepEqual(secondPrune.removedDirectories, [releases[0]]);
    await access(releases[3]);
    await access(releases[4]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
