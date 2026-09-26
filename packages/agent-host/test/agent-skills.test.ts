import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  link,
  rm,
  realpath,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { scanAgentSkills } from "../src/agent-skills.ts";

async function fixture(run: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rah-skills-")));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
async function skill(path: string, name: string, body = "secret body") {
  await mkdir(path, { recursive: true });
  await writeFile(
    join(path, "SKILL.md"),
    `---\nname: ${name}\ndescription: A skill description\nuser-invocable: true\n---\n${body}`,
  );
}

// Global personal-config isolation (2026-09-26): Loom launches Claude with
// `--setting-sources project,local` and Codex with
// `skills.include_instructions=false`, so the Human's global skills never load
// in an instance. The listing reports that instead of presenting them.
test("Codex instances load no skills: both scopes report Loom isolation without reading any skill file", async () =>
  fixture(async (root) => {
    const home = join(root, "human");
    const workspace = join(root, "agent");
    await mkdir(workspace);
    await skill(join(home, ".codex", "skills", "alpha"), "Alpha");
    await skill(join(home, ".agents", "skills", "shared"), "Shared");
    await skill(join(workspace, ".codex", "skills", "local"), "Local");
    const result = await scanAgentSkills({
      cliId: "codex",
      home,
      workspaceRoot: workspace,
    });
    for (const scope of [result.global, result.workspace]) {
      assert.equal(scope.state, "unavailable");
      assert.deepEqual(scope.issues, ["isolated_by_loom"]);
      assert.deepEqual(scope.skills, []);
    }
    assert.ok(!JSON.stringify(result).includes("Alpha"));
    assert.ok(!JSON.stringify(result).includes("Local"));
  }));

test("Claude global skills and commands are reported as not loaded; workspace skills keep their source semantics", async () =>
  fixture(async (root) => {
    const home = join(root, "human");
    const workspace = join(root, "alice");
    await skill(join(home, ".claude", "skills", "first"), "First");
    await mkdir(join(home, ".claude", "commands"));
    await writeFile(
      join(home, ".claude", "commands", "command.md"),
      "---\nname: Command\n---\ncommand body",
    );
    await skill(join(root, "bob", "private"), "PRIVATE");
    await skill(join(workspace, ".claude", "skills", "local"), "Local");
    await mkdir(join(workspace, ".claude", "commands"));
    await writeFile(
      join(workspace, ".claude", "commands", "local.md"),
      "---\nname: Duplicate\n---",
    );
    await writeFile(
      join(workspace, ".claude", "commands", "command.md"),
      "---\nname: Workspace command\n---",
    );
    await symlink(
      join(root, "bob", "private"),
      join(workspace, ".claude", "skills", "escape"),
    );
    await link(
      join(root, "bob", "private", "SKILL.md"),
      join(workspace, ".claude", "skills", "hard.md"),
    );
    const result = await scanAgentSkills({
      cliId: "claude",
      home,
      workspaceRoot: workspace,
    });
    assert.equal(result.global.state, "unavailable");
    assert.deepEqual(result.global.issues, ["isolated_by_loom"]);
    assert.deepEqual(result.global.skills, []);
    assert.ok(!JSON.stringify(result).includes("First"));
    assert.deepEqual(
      result.workspace.skills.map((s) => s.displayName),
      ["Local", "Workspace command"],
    );
    assert.equal(result.workspace.skills[0]?.userInvocable, true);
    assert.equal(result.workspace.state, "partial");
    assert.ok(!JSON.stringify(result).includes("PRIVATE"));
    assert.ok(!JSON.stringify(result).includes("secret body"));
    await symlink(join(root, "bob"), join(root, "fake-agent"));
    const escaped = await scanAgentSkills({
      cliId: "claude",
      home,
      workspaceRoot: join(root, "fake-agent"),
    });
    assert.equal(escaped.workspace.state, "error");
    assert.deepEqual(escaped.workspace.skills, []);
    const empty = await scanAgentSkills({
      cliId: "claude",
      home,
      workspaceRoot: join(root, "absent-agent"),
    });
    assert.equal(empty.workspace.state, "ready");
    assert.deepEqual(empty.workspace.skills, []);
  }));

test("scan limits and metadata bounds are explicit; unsupported runtime never masquerades as a successful empty scan", async () =>
  fixture(async (root) => {
    const home = join(root, "human");
    const workspace = join(root, "agent");
    await skill(
      join(workspace, ".claude", "skills", "a"),
      "A",
      "x".repeat(1_000_000),
    );
    await skill(join(workspace, ".claude", "skills", "b"), "B");
    const result = await scanAgentSkills({
      cliId: "claude",
      home,
      workspaceRoot: workspace,
      limits: { entries: 1 },
    });
    assert.equal(result.workspace.truncated, true);
    assert.equal(result.workspace.skills.length, 1);
    await writeFile(
      join(workspace, ".claude", "skills", "a", "SKILL.md"),
      `---\ndescription: ${"x".repeat(30_000)}\n---`,
    );
    const oversized = await scanAgentSkills({
      cliId: "claude",
      home,
      workspaceRoot: workspace,
    });
    assert.equal(oversized.workspace.state, "partial");
    assert.ok(!oversized.workspace.skills.some((s) => s.name === "a"));
    const unsupported = await scanAgentSkills({
      cliId: "kimi",
      home,
      workspaceRoot: workspace,
    });
    assert.equal(unsupported.global.state, "unavailable");
    assert.equal(unsupported.global.issues[0], "unsupported_runtime");
  }));

test("Skills can resolve a never-started Agent workspace without creating the memory root", async () =>
  fixture(async (root) => {
    const { AgentMemoryCoordinator } =
      await import("../src/agent-memory-coordinator.ts");
    const coordinator = new AgentMemoryCoordinator({
      rootDirectory: join(root, "uncreated-memory"),
      wake: () => false,
      acquireResetFence: async () => ({ release() {} }),
    });
    try {
      const roots = await coordinator.workspaceRoots("never-started");
      assert.equal(roots.roots[0]?.state, "absent");
      await assert.rejects(
        import("node:fs/promises").then((fs) =>
          fs.stat(join(root, "uncreated-memory")),
        ),
        { code: "ENOENT" },
      );
    } finally {
      await coordinator.close();
    }
  }));

test(
  "special files never block reads and permission failures cannot become empty success",
  { timeout: 3000 },
  async () =>
    fixture(async (root) => {
      const { execFileSync } = await import("node:child_process");
      const { chmod } = await import("node:fs/promises");
      const home = join(root, "human");
      const workspace = join(root, "agent");
      const commands = join(workspace, ".claude", "commands");
      await mkdir(commands, { recursive: true });
      execFileSync("/usr/bin/mkfifo", [join(commands, "pipe.md")]);
      const pipeResult = await scanAgentSkills({
        cliId: "claude",
        home,
        workspaceRoot: workspace,
      });
      assert.equal(pipeResult.workspace.state, "error");
      assert.deepEqual(pipeResult.workspace.issues, ["blocked_path"]);
      await rm(join(commands, "pipe.md"));
      const denied = join(commands, "denied.md");
      await writeFile(denied, "---\nname: PRIVATE DENIED\n---");
      await chmod(denied, 0);
      const permissionResult = await scanAgentSkills({
        cliId: "claude",
        home,
        workspaceRoot: workspace,
      });
      assert.equal(permissionResult.workspace.state, "error");
      assert.deepEqual(permissionResult.workspace.issues, ["read_failed"]);
      assert.deepEqual(permissionResult.workspace.skills, []);
    }),
);
