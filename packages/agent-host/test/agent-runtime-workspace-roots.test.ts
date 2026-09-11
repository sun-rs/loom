import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { AgentMemoryCoordinator } from "../src/agent-memory-coordinator.ts";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "rah-owner-project-roots-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const memory = join(directory, "memory");
  const projects = new Map<string, string>();
  for (const owner of ["alice", "bob", "legacy"]) {
    const root = join(directory, owner);
    await mkdir(root);
    await writeFile(join(root, `${owner}.txt`), owner);
    projects.set(owner, await realpath(root));
  }
  return { memory, projects };
}

test("runtime roots, listings and previews resolve the requested Agent without changing memory roots", async (t) => {
  const { memory, projects } = await fixture(t);
  const seen: string[] = [];
  const coordinator = new AgentMemoryCoordinator({
    rootDirectory: memory,
    projectDirectory: projects.get("legacy")!,
    resolveProjectDirectory: async (owner: string) => {
      seen.push(owner);
      return projects.get(owner);
    },
    wake: () => false,
  });
  t.after(() => coordinator.close());
  for (const owner of ["alice", "bob"]) {
    const roots = await coordinator.workspaceRoots(owner);
    assert.equal(
      roots.roots.find((root) => root.rootId === "runtime-project")?.rootPath,
      projects.get(owner),
    );
    assert.equal(roots.defaultRootId, "agent-workspace");
    const memoryRoot = roots.roots.find(
      (root) => root.rootId === "agent-workspace",
    );
    assert.equal(memoryRoot?.state, "absent");
    assert.ok(memoryRoot?.rootPath.startsWith(memory));
    const listing = await coordinator.browseWorkspace(
      owner,
      "runtime-project",
      "",
      false,
    );
    assert.deepEqual(
      listing.entries.map((entry) => entry.path),
      [`${owner}.txt`],
    );
    assert.equal(
      (
        await coordinator.previewWorkspaceFile(
          owner,
          "runtime-project",
          `${owner}.txt`,
        )
      ).content,
      owner,
    );
    const other = owner === "alice" ? "bob" : "alice";
    await assert.rejects(
      coordinator.previewWorkspaceFile(
        owner,
        "runtime-project",
        `../${other}/${other}.txt`,
      ),
    );
  }
  assert.deepEqual(seen, [
    "alice",
    "alice",
    "alice",
    "alice",
    "bob",
    "bob",
    "bob",
    "bob",
  ]);
  const missing = await coordinator.workspaceRoots("unbound");
  assert.equal(missing.roots.length, 1);
  await assert.rejects(
    coordinator.browseWorkspace("unbound", "runtime-project", "", false),
    /尚未配置/,
  );
  await assert.rejects(
    coordinator.previewWorkspaceFile(
      "unbound",
      "runtime-project",
      "legacy.txt",
    ),
    /尚未配置/,
  );
});

test("runtime project access validates owner before invoking resolver and rejects unsafe roots", async (t) => {
  const { memory } = await fixture(t);
  let calls = 0;
  let project = "relative";
  const coordinator = new AgentMemoryCoordinator({
    rootDirectory: memory,
    resolveProjectDirectory: async () => {
      calls++;
      return project;
    },
    wake: () => false,
  });
  t.after(() => coordinator.close());
  for (const read of [
    (owner: string) => coordinator.workspaceRoots(owner),
    (owner: string) =>
      coordinator.browseWorkspace(owner, "runtime-project", "", false),
    (owner: string) =>
      coordinator.previewWorkspaceFile(owner, "runtime-project", "file.txt"),
  ]) {
    await assert.rejects(read("../alice"), /participant is invalid/);
    assert.equal(calls, 0);
  }
  await assert.rejects(coordinator.workspaceRoots("alice"), /must be absolute/);
  project = "/";
  await assert.rejects(coordinator.workspaceRoots("alice"), /Filesystem root/);
});

test("without resolver the existing shared project setting still works", async (t) => {
  const { memory, projects } = await fixture(t);
  const coordinator = new AgentMemoryCoordinator({
    rootDirectory: memory,
    projectDirectory: projects.get("legacy")!,
    wake: () => false,
  });
  t.after(() => coordinator.close());
  for (const owner of ["alice", "bob"]) {
    assert.equal(
      (await coordinator.workspaceRoots(owner)).roots[1]?.rootPath,
      projects.get("legacy"),
    );
    assert.equal(
      (
        await coordinator.previewWorkspaceFile(
          owner,
          "runtime-project",
          "legacy.txt",
        )
      ).content,
      "legacy",
    );
  }
});
