import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
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
