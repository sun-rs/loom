import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, link, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { agentMemoryWorkspacePath } from "../src/agent-memory-workspace.ts";
import {
  listAgentWorkspace,
  readAgentWorkspace,
} from "../src/agent-workspace-browser.ts";

test("Agent workspace is lazy, owner scoped, hidden-aware and bounded; reading never seeds memory", async () => {
  const root = await mkdtemp(join(tmpdir(), "rah-workspace-browser-"));
  const home = agentMemoryWorkspacePath(root, "alice");
  try {
    assert.equal(
      (await listAgentWorkspace(root, "alice", "", false)).state,
      "absent",
    );
    await mkdir(join(home, "notes"), { recursive: true });
    await mkdir(join(home, ".ssh"));
    await mkdir(join(home, "node_modules"));
    await writeFile(join(home, "MEMORY.md"), "# Alice\nsmall index");
    await writeFile(join(home, "notes", "guide.md"), "curated note");
    await writeFile(join(home, ".env"), "SECRET=do-not-return");
    await writeFile(join(home, ".settings"), "visible only when opted in");
    await writeFile(join(home, "too-large.txt"), Buffer.alloc(1048577));
    await writeFile(join(root, "outside.txt"), "outside");
    await symlink(join(root, "outside.txt"), join(home, "escape.txt"));
    await link(join(root, "outside.txt"), join(home, "hard.txt"));
    const listing = await listAgentWorkspace(root, "alice", "", false);
    assert.equal(listing.entries[0]?.path, "notes");
    assert.ok(!listing.entries.some((e) => e.path.includes("guide.md")));
    assert.ok(
      !listing.entries.some((e) =>
        [
          ".env",
          ".settings",
          ".ssh",
          "node_modules",
          "escape.txt",
          "hard.txt",
        ].includes(e.path),
      ),
    );
    const hidden = await listAgentWorkspace(root, "alice", "", true);
    assert.ok(hidden.entries.some((e) => e.path === ".settings"));
    assert.ok(!hidden.entries.some((e) => e.path === ".ssh"));
    assert.equal(
      (await readAgentWorkspace(root, "alice", "notes/guide.md")).content,
      "curated note",
    );
    assert.equal(
      (await listAgentWorkspace(root, "bob", "", false)).state,
      "absent",
    );
    for (const path of [
      "../outside.txt",
      "/etc/passwd",
      ".env",
      "escape.txt",
      "hard.txt",
      "too-large.txt",
      "notes",
    ]) {
      await assert.rejects(
        readAgentWorkspace(root, "alice", path),
        Error,
        path,
      );
    }
    await assert.rejects(listAgentWorkspace(root, "alice", ".ssh", true));
    await assert.rejects(listAgentWorkspace(root, "alice", "../", true));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
