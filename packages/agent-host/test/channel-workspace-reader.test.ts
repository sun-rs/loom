import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { readChannelWorkspace } from "../src/channel-workspace-reader.ts";

test("channel workspace reads are lazy, bounded and scoped; Git never executes diff helpers", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-channel-workspace-"));
  const workspace = {
    kind: "channel_home" as const,
    primaryDirectory: root,
    additionalDirectories: [],
  };
  const base = {
    roomId: "room",
    rootId: "runtime-project" as const,
    path: "",
    includeHidden: false,
  };
  const read = (operation: string, path = "") =>
    readChannelWorkspace(workspace, { ...base, operation, path } as never);
  try {
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested/a.md"), "before\n");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root });
    git("init", "-q");
    git("add", ".");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "base",
    );
    await writeFile(join(root, "nested/a.md"), "after\n");
    await writeFile(join(root, ".env"), "SECRET");
    await symlink("/etc/passwd", join(root, "escape.txt"));
    const listing = await read("list");
    assert.equal(listing.kind, "list");
    if (listing.kind === "list")
      assert.deepEqual(
        listing.value.entries.map((e) => e.name),
        ["nested"],
      );
    const status = await read("changes");
    assert.equal(status.kind, "changes");
    if (status.kind === "changes")
      assert.deepEqual(
        status.entries.map((e) => e.path),
        ["nested/a.md"],
      );
    git("config", "diff.external", "false");
    const diff = await read("diff", "nested/a.md");
    assert.equal(diff.kind, "diff");
    if (diff.kind === "diff") {
      assert.match(diff.text, /-before/);
      assert.match(diff.text, /\+after/);
    }
    for (const path of ["../outside", ".env", "escape.txt"])
      await assert.rejects(read("diff", path));
    await assert.rejects(
      readChannelWorkspace(workspace, {
        ...base,
        operation: "list",
        rootId: "attached-project-1",
      }),
    );
    await writeFile(join(root, "new.md"), "new file\n");
    const added = await read("diff", "new.md");
    if (added.kind === "diff") assert.match(added.text, /\+new file/);
    await rm(join(root, "nested/a.md"));
    const deleted = await read("diff", "nested/a.md");
    if (deleted.kind === "diff") assert.match(deleted.text, /-before/);
    await writeFile(join(root, "large.md"), "x".repeat(600000));
    await assert.rejects(read("diff", "large.md"), /512 KiB/);
    await mkdir(join(root, "nested/sub"));
    await assert.rejects(
      readChannelWorkspace(
        { ...workspace, primaryDirectory: join(root, "nested") },
        { ...base, operation: "changes" },
      ),
      /repository root/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
