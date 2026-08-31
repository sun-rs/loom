import assert from "node:assert/strict";
import {
  chmod,
  lstat,
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
  buildWorkspaceInstructionPack,
  ensureWorkspaceInstructionPack,
  verifyWorkspaceInstructionPack,
} from "../src/index.ts";

test("Workspace instruction pack installs, replaces, and verifies only managed files", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "rah-workspace-pack-"));
  context.after(
    async () => await rm(workspace, { force: true, recursive: true }),
  );
  await writeFile(join(workspace, "unrelated.txt"), "keep me\n");
  const first = buildWorkspaceInstructionPack([
    { content: "Agent rules v1\n", relativePath: "AGENTS.md" },
    { content: "Claude rules v1\n", relativePath: "CLAUDE.md" },
    {
      content: "Review v1\n",
      relativePath: ".agents/skills/review/SKILL.md",
    },
  ]);
  const installed = await ensureWorkspaceInstructionPack(workspace, first);
  assert.equal(installed.kind, "installed");
  assert.equal(installed.packId, first.packId);
  assert.equal(
    await readFile(join(workspace, "AGENTS.md"), "utf8"),
    "Agent rules v1\n",
  );
  assert.equal(
    await readFile(join(workspace, "unrelated.txt"), "utf8"),
    "keep me\n",
  );
  assert.equal(
    (await lstat(join(workspace, ".rah/workspace-instruction-pack.json")))
      .mode & 0o777,
    0o600,
  );
  assert.equal(
    (await verifyWorkspaceInstructionPack(workspace))?.packId,
    first.packId,
  );
  assert.equal(
    (await ensureWorkspaceInstructionPack(workspace, first)).kind,
    "unchanged",
  );

  const second = buildWorkspaceInstructionPack([
    { content: "Agent rules v2\n", relativePath: "AGENTS.md" },
    { content: "Claude rules v2\n", relativePath: "CLAUDE.md" },
    {
      content: "Ship v1\n",
      relativePath: ".claude/skills/ship/SKILL.md",
    },
  ]);
  const markerPath = join(workspace, ".rah/workspace-instruction-pack.json");
  const forgedMarker = JSON.parse(await readFile(markerPath, "utf8")) as Record<
    string,
    unknown
  >;
  forgedMarker.packId = second.packId;
  await writeFile(markerPath, `${JSON.stringify(forgedMarker)}\n`, {
    mode: 0o600,
  });
  assert.equal(
    (await ensureWorkspaceInstructionPack(workspace, second)).kind,
    "installed",
  );
  await assert.rejects(
    readFile(join(workspace, ".agents/skills/review/SKILL.md")),
    /ENOENT/u,
  );
  assert.equal(
    await readFile(join(workspace, ".claude/skills/ship/SKILL.md"), "utf8"),
    "Ship v1\n",
  );
  assert.equal(
    await readFile(join(workspace, "unrelated.txt"), "utf8"),
    "keep me\n",
  );
});

test("Workspace instruction pack rejects symlink traversal and rolls back an interrupted replacement", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "rah-workspace-pack-safe-"));
  const outside = await mkdtemp(join(tmpdir(), "rah-workspace-pack-outside-"));
  context.after(async () => {
    await rm(workspace, { force: true, recursive: true });
    await rm(outside, { force: true, recursive: true });
  });
  const first = buildWorkspaceInstructionPack([
    { content: "Agent original\n", relativePath: "AGENTS.md" },
    { content: "Claude original\n", relativePath: "CLAUDE.md" },
  ]);
  await ensureWorkspaceInstructionPack(workspace, first);
  const replacement = buildWorkspaceInstructionPack([
    { content: "Agent replacement\n", relativePath: "AGENTS.md" },
    { content: "Claude replacement\n", relativePath: "CLAUDE.md" },
  ]);
  await assert.rejects(
    ensureWorkspaceInstructionPack(workspace, replacement, {
      afterBackup: async () => {
        throw new Error("injected interruption");
      },
    }),
    /injected interruption/u,
  );
  assert.equal(
    await readFile(join(workspace, "AGENTS.md"), "utf8"),
    "Agent original\n",
  );
  assert.equal(
    (await verifyWorkspaceInstructionPack(workspace))?.packId,
    first.packId,
  );

  await symlink(outside, join(workspace, ".agents"));
  const unsafe = buildWorkspaceInstructionPack([
    { content: "Agent rules\n", relativePath: "AGENTS.md" },
    { content: "Claude rules\n", relativePath: "CLAUDE.md" },
    {
      content: "Unsafe\n",
      relativePath: ".agents/skills/unsafe/SKILL.md",
    },
  ]);
  await assert.rejects(
    ensureWorkspaceInstructionPack(workspace, unsafe),
    /symbolic link/u,
  );
  await assert.rejects(
    readFile(join(outside, "skills/unsafe/SKILL.md")),
    /ENOENT/u,
  );
});

test("Workspace instruction pack rejects writable managed ancestors", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "rah-workspace-pack-mode-"));
  context.after(
    async () => await rm(workspace, { force: true, recursive: true }),
  );
  await mkdir(join(workspace, ".agents"), { mode: 0o700 });
  await chmod(join(workspace, ".agents"), 0o777);
  const pack = buildWorkspaceInstructionPack([
    { content: "Agent rules\n", relativePath: "AGENTS.md" },
    { content: "Claude rules\n", relativePath: "CLAUDE.md" },
    {
      content: "Review rules\n",
      relativePath: ".agents/skills/review/SKILL.md",
    },
  ]);

  await assert.rejects(
    ensureWorkspaceInstructionPack(workspace, pack),
    /owner-controlled ancestor/u,
  );
});
