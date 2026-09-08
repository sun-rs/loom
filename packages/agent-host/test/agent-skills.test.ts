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

test("Codex scans actual configured home, builtins and Agent workspace metadata only; missing is an honest empty result", async () =>
  fixture(async (root) => {
    const home = join(root, "human");
    const codexHome = join(root, "effective-codex");
    const workspace = join(root, "agent");
    await mkdir(workspace);
    await skill(join(codexHome, "skills", "alpha"), "Alpha");
    await skill(join(codexHome, "skills", ".system", "system"), "System");
    await skill(join(codexHome, ".agents", "skills", "shared"), "Shared");
    await skill(join(home, ".agents", "skills", "excluded"), "Wrong home");
    await skill(join(workspace, ".codex", "skills", "local"), "Local");
    const result = await scanAgentSkills({
      cliId: "codex",
      home,
      codexHome,
      workspaceRoot: workspace,
    });
    assert.equal(result.global.state, "ready");
    assert.deepEqual(
      result.global.skills.map((s) => s.displayName),
      ["Alpha", "System", "Shared"],
    );
    assert.equal(result.global.skills[0]?.userInvocable, true);
    assert.deepEqual(
      result.workspace.skills.map((s) => s.displayName),
      ["Local"],
    );
    assert.ok(!JSON.stringify(result).includes("secret body"));
    const empty = await scanAgentSkills({
      cliId: "claude",
      home,
      workspaceRoot: join(root, "absent-agent"),
    });
    assert.equal(empty.workspace.state, "ready");
    assert.deepEqual(empty.workspace.skills, []);
  }));

test("Claude commands, source groups, dedup and approved provider links match the source without leaking another Agent", async () =>
  fixture(async (root) => {
    const home = join(root, "human");
    const workspace = join(root, "alice");
    await skill(join(home, ".claude", "skills", "first"), "First");
    await mkdir(join(home, ".claude", "commands"));
    await writeFile(
      join(home, ".claude", "commands", "command.md"),
      "---\nname: Command\n---\ncommand body",
    );
    await writeFile(
      join(home, ".claude", "commands", "first.md"),
      "---\nname: Duplicate\n---",
    );
    await skill(join(home, ".agents", "skills", "shared"), "Linked");
    await symlink(
      join(home, ".agents", "skills", "shared"),
      join(home, ".claude", "skills", "shared"),
    );
    await skill(join(root, "bob", "private"), "PRIVATE");
    await skill(join(workspace, ".claude", "skills", "local"), "Local");
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
    assert.deepEqual(
      result.global.skills.map((s) => s.displayName),
      ["First", "Linked", "Command"],
    );
    assert.equal(result.global.skills[0]?.sourcePath, "~/.claude/skills");
    assert.deepEqual(
      result.workspace.skills.map((s) => s.displayName),
      ["Local"],
    );
    assert.equal(result.workspace.state, "partial");
    assert.ok(!JSON.stringify(result).includes("PRIVATE"));
    await symlink(join(root, "bob"), join(root, "fake-agent"));
    const escaped = await scanAgentSkills({
      cliId: "claude",
      home,
      workspaceRoot: join(root, "fake-agent"),
    });
    assert.equal(escaped.workspace.state, "error");
    assert.deepEqual(escaped.workspace.skills, []);
  }));

test("scan limits and metadata bounds are explicit; unsupported runtime never masquerades as a successful empty scan", async () =>
  fixture(async (root) => {
    const home = join(root, "human");
    const workspace = join(root, "agent");
    await skill(
      join(home, ".claude", "skills", "a"),
      "A",
      "x".repeat(1_000_000),
    );
    await skill(join(home, ".claude", "skills", "b"), "B");
    const result = await scanAgentSkills({
      cliId: "claude",
      home,
      workspaceRoot: workspace,
      limits: { entries: 1 },
    });
    assert.equal(result.global.truncated, true);
    assert.equal(result.global.skills.length, 1);
    await writeFile(
      join(home, ".claude", "skills", "a", "SKILL.md"),
      `---\ndescription: ${"x".repeat(30_000)}\n---`,
    );
    const oversized = await scanAgentSkills({
      cliId: "claude",
      home,
      workspaceRoot: workspace,
    });
    assert.equal(oversized.global.state, "partial");
    assert.ok(!oversized.global.skills.some((s) => s.name === "a"));
    const unsupported = await scanAgentSkills({
      cliId: "kimi",
      home,
      workspaceRoot: workspace,
    });
    assert.equal(unsupported.global.state, "unavailable");
    assert.equal(unsupported.global.issues[0], "unsupported_runtime");
    const relativeHome = await scanAgentSkills({
      cliId: "codex",
      home,
      codexHome: "relative",
      workspaceRoot: workspace,
    });
    assert.equal(relativeHome.global.state, "unavailable");
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

test("default global roots cannot promote a root symlink into authorization for another Agent", async () =>
  fixture(async (root) => {
    const home = join(root, "human");
    await mkdir(join(home, ".agents"), { recursive: true });
    await skill(
      join(root, "bob-private", "private-skill"),
      "BOB PRIVATE METADATA",
    );
    await symlink(join(root, "bob-private"), join(home, ".agents", "skills"));
    const result = await scanAgentSkills({
      cliId: "codex",
      home,
      workspaceRoot: join(root, "alice"),
    });
    assert.equal(result.global.state, "error");
    assert.deepEqual(result.global.issues, ["blocked_path"]);
    assert.ok(!JSON.stringify(result).includes("BOB PRIVATE"));
  }));

test(
  "special files never block reads and permission failures cannot become empty success",
  { timeout: 3000 },
  async () =>
    fixture(async (root) => {
      const { execFileSync } = await import("node:child_process");
      const { chmod } = await import("node:fs/promises");
      const home = join(root, "human");
      const commands = join(home, ".claude", "commands");
      await mkdir(commands, { recursive: true });
      execFileSync("/usr/bin/mkfifo", [join(commands, "pipe.md")]);
      const pipeResult = await scanAgentSkills({
        cliId: "claude",
        home,
        workspaceRoot: join(root, "agent"),
      });
      assert.equal(pipeResult.global.state, "error");
      assert.deepEqual(pipeResult.global.issues, ["blocked_path"]);
      await rm(join(commands, "pipe.md"));
      const denied = join(commands, "denied.md");
      await writeFile(denied, "---\nname: PRIVATE DENIED\n---");
      await chmod(denied, 0);
      const permissionResult = await scanAgentSkills({
        cliId: "claude",
        home,
        workspaceRoot: join(root, "agent"),
      });
      assert.equal(permissionResult.global.state, "error");
      assert.deepEqual(permissionResult.global.issues, ["read_failed"]);
      assert.deepEqual(permissionResult.global.skills, []);
    }),
);

test("Claude config override is the actual global source, leaving per-Agent workspace semantics intact", async () =>
  fixture(async (root) => {
    const home = join(root, "human");
    const config = join(root, "effective-claude");
    await skill(join(home, ".claude", "skills", "wrong"), "WRONG DEFAULT");
    await skill(join(config, "skills", "actual"), "Actual configured skill");
    const result = await scanAgentSkills({
      cliId: "claude",
      home,
      claudeConfigDirectory: config,
      workspaceRoot: join(root, "agent"),
    });
    assert.deepEqual(
      result.global.skills.map((skill) => skill.displayName),
      ["Actual configured skill"],
    );
    assert.equal(result.workspace.state, "ready");
  }));
