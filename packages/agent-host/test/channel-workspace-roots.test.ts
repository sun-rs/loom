import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentMemoryCoordinator } from "../src/agent-memory-coordinator.ts";

/**
 * Owner 2026-09-26: file browsing of a channel-home instance covers the
 * home (`runtime-project`) and each attached directory, through the same
 * root-scoped reader (no traversal, secrets and `.git` filtered).
 */
test("workspace roots list the channel home and every attached directory; browsing stays root-scoped", async (t) => {
  const base = await realpath(
    await mkdtemp(join(tmpdir(), "rah-channel-roots-")),
  );
  t.after(() => rm(base, { recursive: true, force: true }));
  const home = join(base, "homes", "room-1");
  const app = join(base, "app");
  const lib = join(base, "lib");
  for (const directory of [home, app, lib])
    await mkdir(directory, { recursive: true });
  await writeFile(join(home, "product.md"), "home");
  await writeFile(join(app, "main.ts"), "app");
  await writeFile(join(app, ".env"), "SECRET=1");
  await writeFile(join(lib, "lib.ts"), "lib");
  const coordinator = new AgentMemoryCoordinator({
    rootDirectory: join(base, "memory"),
    resolveProjectDirectory: async (owner) =>
      owner === "instance" ? home : undefined,
    resolveAttachedDirectories: async (owner) =>
      owner === "instance" ? [app, lib, join(base, "gone")] : [],
    wake: () => false,
  });
  t.after(() => coordinator.close());
  const roots = await coordinator.workspaceRoots("instance");
  assert.deepEqual(
    roots.roots.map((root) => [root.rootId, root.rootPath, root.state]),
    [
      ["agent-workspace", roots.roots[0]!.rootPath, "absent"],
      ["runtime-project", home, "ready"],
      ["attached-project-1", app, "ready"],
      ["attached-project-2", lib, "ready"],
      ["attached-project-3", join(base, "gone"), "absent"],
    ],
  );
  assert.deepEqual(
    (
      await coordinator.browseWorkspace(
        "instance",
        "attached-project-1",
        "",
        true,
      )
    ).entries.map((entry) => entry.path),
    ["main.ts"],
    "secret files stay hidden",
  );
  assert.equal(
    (
      await coordinator.previewWorkspaceFile(
        "instance",
        "attached-project-2",
        "lib.ts",
      )
    ).content,
    "lib",
  );
  assert.equal(
    (
      await coordinator.previewWorkspaceFile(
        "instance",
        "runtime-project",
        "product.md",
      )
    ).content,
    "home",
  );
  await assert.rejects(
    coordinator.previewWorkspaceFile(
      "instance",
      "attached-project-1",
      "../lib/lib.ts",
    ),
  );
  await assert.rejects(
    coordinator.browseWorkspace("instance", "attached-project-4", "", false),
    /attached directory/u,
  );
  await assert.rejects(
    coordinator.browseWorkspace("other", "attached-project-1", "", false),
    /attached directory/u,
  );
  assert.deepEqual(
    (await coordinator.workspaceRoots("other")).roots.map((r) => r.rootId),
    ["agent-workspace"],
  );
});
