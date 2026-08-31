import assert from "node:assert/strict";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadAgentMemoryRunSource,
  prepareAgentMemoryRunSource,
} from "../src/agent-memory-project.ts";

test("one explicit project resolves multiple checkouts, not same-named or prefix-neighbor folders", async () => {
  const root = await mkdtemp(join(tmpdir(), "rah-memory-project-"));
  try {
    const memory = join(root, "memory");
    const a = join(root, "a", "same-name");
    const b = join(root, "b", "same-name");
    const c = join(root, "c", "same-name");
    const nested = join(a, "subproject");
    const neighbor = `${a}-other`;
    for (const path of [memory, a, b, c, nested, neighbor])
      await mkdir(path, { recursive: true, mode: 0o700 });
    const config = {
      schemaVersion: 1,
      projects: [
        {
          key: "core",
          label: "Core",
          roots: [a, b, join(root, "gone-checkout")],
          relatedKeys: ["ui"],
        },
        { key: "ui", label: "UI", roots: [c, nested], relatedKeys: [] },
      ],
    };
    await writeFile(
      join(memory, ".project-bindings.json"),
      JSON.stringify(config),
      { mode: 0o600 },
    );
    const sourceA = await loadAgentMemoryRunSource({
      rootDirectory: memory,
      cwd: a,
    });
    const sourceB = await loadAgentMemoryRunSource({
      rootDirectory: memory,
      cwd: b,
    });
    assert.equal(sourceA.resolution, "matched");
    if (sourceA.resolution !== "matched" || sourceB.resolution !== "matched")
      throw new Error("not matched");
    assert.equal(sourceA.project.key, "core");
    assert.deepEqual(sourceA.project, sourceB.project);
    assert.deepEqual(sourceA.relatedKeys, ["ui"]);
    const sourceC = await loadAgentMemoryRunSource({
      rootDirectory: memory,
      cwd: c,
    });
    assert.equal(sourceC.resolution === "matched" && sourceC.project.key, "ui");
    const sourceNested = await loadAgentMemoryRunSource({
      rootDirectory: memory,
      cwd: nested,
    });
    assert.equal(
      sourceNested.resolution === "matched" && sourceNested.project.key,
      "ui",
    );
    assert.equal(
      (await loadAgentMemoryRunSource({ rootDirectory: memory, cwd: neighbor }))
        .resolution,
      "unmatched",
    );
    assert.equal(
      await readFile(join(memory, ".project-bindings.json"), "utf8"),
      JSON.stringify(config),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("physical alias conflicts fail closed while an explicit symlink alias to one project works", async () => {
  const root = await mkdtemp(join(tmpdir(), "rah-memory-project-alias-"));
  try {
    const memory = join(root, "memory"),
      cwd = join(root, "repo"),
      alias = join(root, "alias");
    await mkdir(memory, { mode: 0o700 });
    await mkdir(cwd);
    await symlink(cwd, alias);
    const path = join(memory, ".project-bindings.json");
    const project = {
      key: "main",
      label: "Main",
      roots: [alias],
      relatedKeys: [],
    };
    await writeFile(
      path,
      JSON.stringify({ schemaVersion: 1, projects: [project] }),
      { mode: 0o600 },
    );
    const selected = await loadAgentMemoryRunSource({
      rootDirectory: memory,
      cwd,
    });
    assert.equal(
      selected.resolution === "matched" && selected.project.key,
      "main",
    );
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        projects: [project, { ...project, key: "other", roots: [cwd] }],
      }),
    );
    await assert.rejects(
      loadAgentMemoryRunSource({ rootDirectory: memory, cwd }),
      /ambiguous.*physical/iu,
    );
    const rootAlias = join(root, "root-alias");
    await symlink("/", rootAlias);
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        projects: [{ ...project, roots: [rootAlias] }],
      }),
    );
    await assert.rejects(
      loadAgentMemoryRunSource({ rootDirectory: memory, cwd }),
      /filesystem root/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing configuration stays unknown; unsafe, oversized and malformed catalogs are not silently ignored", async () => {
  const root = await mkdtemp(join(tmpdir(), "rah-memory-project-safety-"));
  try {
    const memory = join(root, "memory");
    await mkdir(memory, { mode: 0o700 });
    const path = join(memory, ".project-bindings.json");
    assert.equal(
      (await loadAgentMemoryRunSource({ rootDirectory: memory, cwd: root }))
        .resolution,
      "unconfigured",
    );
    await writeFile(path, "not-json", { mode: 0o600 });
    await assert.rejects(
      loadAgentMemoryRunSource({ rootDirectory: memory, cwd: root }),
      /JSON/u,
    );
    await writeFile(path, JSON.stringify({ schemaVersion: 1, projects: [] }));
    await chmod(path, 0o644);
    const unavailable = await prepareAgentMemoryRunSource({
      rootDirectory: memory,
      cwd: root,
    });
    assert.equal(unavailable.resolution, "unavailable");
    assert.equal("project" in unavailable, false);
    await assert.rejects(
      loadAgentMemoryRunSource({ rootDirectory: memory, cwd: root }),
      /private/u,
    );
    await chmod(path, 0o600);
    await writeFile(path, " ".repeat(262145));
    await assert.rejects(
      loadAgentMemoryRunSource({ rootDirectory: memory, cwd: root }),
      /exceeds/u,
    );
    await rm(path);
    const target = join(root, "config");
    await writeFile(
      target,
      JSON.stringify({ schemaVersion: 1, projects: [] }),
      { mode: 0o600 },
    );
    await symlink(target, path);
    await assert.rejects(
      loadAgentMemoryRunSource({ rootDirectory: memory, cwd: root }),
    );
    await rm(path);
    await link(target, path);
    await assert.rejects(
      loadAgentMemoryRunSource({ rootDirectory: memory, cwd: root }),
      /private/u,
    );
    assert.equal(
      (await prepareAgentMemoryRunSource({ rootDirectory: memory, cwd: root }))
        .resolution,
      "unavailable",
    );
    await chmod(memory, 0o755);
    await assert.rejects(
      prepareAgentMemoryRunSource({ rootDirectory: memory, cwd: root }),
      /private/u,
      "unsafe memory roots must not be swallowed as optional metadata errors",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
