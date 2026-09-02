import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, link, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { agentMemoryWorkspacePath } from "../src/agent-memory-workspace.ts";
import {
  listWorkspaceRoot,
  listAgentWorkspace,
  readWorkspaceRoot,
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

test("a frozen local project root reuses the bounded browser without accepting client paths", async () => {
  const project = await mkdtemp(join(tmpdir(), "rah-project-browser-"));
  const outside = await mkdtemp(join(tmpdir(), "rah-project-outside-"));
  try {
    await mkdir(join(project, "src"));
    await mkdir(join(project, ".git"));
    await writeFile(join(project, "README.md"), "# RAH\nproject");
    await writeFile(join(project, "src", "index.ts"), "export {};\n");
    await writeFile(join(project, ".env"), "TOKEN=hidden");
    await writeFile(join(project, ".project-note"), "visible by opt-in");
    await writeFile(join(outside, "escape.md"), "outside");
    await symlink(join(outside, "escape.md"), join(project, "escape.md"));
    await link(join(outside, "escape.md"), join(project, "hard.md"));

    const base = {
      rootDirectory: project,
      rootId: "runtime-project" as const,
      rootKind: "runtime-project" as const,
      rootLabel: "RAH OS",
    };
    const listing = await listWorkspaceRoot({
      ...base,
      includeHidden: false,
      path: "",
    });
    assert.equal(listing.rootId, "runtime-project");
    assert.deepEqual(
      listing.entries.map((entry) => entry.path),
      ["src", "README.md"],
    );
    const hidden = await listWorkspaceRoot({
      ...base,
      includeHidden: true,
      path: "",
    });
    assert.ok(hidden.entries.some((entry) => entry.path === ".project-note"));
    assert.ok(!hidden.entries.some((entry) => entry.path === ".env"));
    assert.ok(!hidden.entries.some((entry) => entry.path === "escape.md"));
    assert.ok(!hidden.entries.some((entry) => entry.path === "hard.md"));
    assert.equal(
      (
        await readWorkspaceRoot({
          ...base,
          path: "src/index.ts",
        })
      ).content,
      "export {};\n",
    );
    await assert.rejects(readWorkspaceRoot({ ...base, path: "../escape.md" }));
    await assert.rejects(readWorkspaceRoot({ ...base, path: "escape.md" }));
    await assert.rejects(readWorkspaceRoot({ ...base, path: "hard.md" }));
    await assert.rejects(
      listWorkspaceRoot({
        ...base,
        includeHidden: true,
        path: ".git",
      }),
    );
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
