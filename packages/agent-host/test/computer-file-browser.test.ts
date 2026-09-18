import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rm,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ComputerFileBrowser } from "../src/computer-file-browser.ts";
import {
  listWorkspaceRoot,
  readWorkspaceRoot,
} from "../src/agent-workspace-browser.ts";

test("computer references start at home and navigate ancestors without granting workspace reads", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rah-file-home-")));
  try {
    await mkdir(join(root, "Users", "owner"), { recursive: true });
    const initialDirectory = join(root, "Users", "owner");
    const browser = new ComputerFileBrowser({
      hostId: "mac",
      label: "Mac",
      roots: ["/"],
      initialDirectory,
    });
    const home = await browser.list({ path: "" });
    assert.equal(home.absolutePath, initialDirectory);
    assert.equal(home.path, initialDirectory.slice(1));
    let current = home;
    while (current.path) {
      current = await browser.list({
        rootId: current.rootId,
        path: current.path.split("/").slice(0, -1).join("/"),
      });
    }
    assert.equal(current.absolutePath, "/");
    assert.ok(current.entries.some((entry) => entry.isDirectory));
    for (const path of ["../", "/etc", "Users/../etc", ".ssh"])
      await assert.rejects(browser.list({ rootId: home.rootId, path }));
    const workspace = {
      rootDirectory: "/",
      rootId: "runtime-project" as const,
      rootKind: "runtime-project" as const,
      rootLabel: "project",
      path: "",
    };
    await assert.rejects(listWorkspaceRoot(workspace), /Filesystem root/);
    await assert.rejects(
      readWorkspaceRoot({ ...workspace, path: "etc/hosts" }),
      /Filesystem root/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("computer references list authorized roots without reading or uploading contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "rah-file-reference-"));
  try {
    await mkdir(join(root, "Documents"));
    await writeFile(join(root, "Documents", "a file.txt"), "private content");
    await symlink("/", join(root, "escape"));
    await mkdir(join(root, ".ssh"));
    const browser = new ComputerFileBrowser({
      hostId: "mac",
      label: "Test Mac",
      roots: [root],
    });
    const top = await browser.list({ path: "", includeHidden: true });
    assert.equal(top.hostId, "mac");
    assert.deepEqual(
      top.entries.map((e) => e.name),
      ["Documents"],
    );
    const listing = await browser.list({
      hostId: "mac",
      rootId: "root-0",
      path: "Documents",
    });
    assert.equal(
      listing.entries[0]?.absolutePath,
      join(root, "Documents", "a file.txt"),
    );
    assert.equal("content" in listing.entries[0]!, false);
    for (const path of [
      "../",
      "/etc",
      "escape",
      ".ssh",
      "Documents/../../etc",
    ]) {
      await assert.rejects(browser.list({ path }));
    }
    await assert.rejects(browser.list({ hostId: "other", path: "" }));
    await assert.rejects(browser.list({ rootId: "root-unknown", path: "" }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
