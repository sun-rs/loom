import assert from "node:assert/strict";
import {
  mkdtemp,
  realpath,
  rm,
  writeFile,
  readFile,
  symlink,
  mkdir,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  agentExecutionWorkspacePath,
  prepareAgentExecutionWorkspace,
  quarantineAgentExecutionWorkspace,
} from "../src/agent-execution-workspace.ts";

async function fixture(t: TestContext) {
  const base = await mkdtemp(
    join(await realpath(tmpdir()), "agent-execution-"),
  );
  t.after(() => rm(base, { recursive: true, force: true }));
  return base;
}

test("execution cwd is stable, private, separate per participant and never seeds memory", async (t) => {
  const rootDirectory = join(await fixture(t), "execution");
  const a = await prepareAgentExecutionWorkspace({
    rootDirectory,
    participantId: "agent/a",
  });
  await writeFile(join(a.cwd, "project.txt"), "keep");
  assert.equal(
    (
      await prepareAgentExecutionWorkspace({
        rootDirectory,
        participantId: "agent/a",
      })
    ).cwd,
    a.cwd,
  );
  assert.equal(await readFile(join(a.cwd, "project.txt"), "utf8"), "keep");
  const b = await prepareAgentExecutionWorkspace({
    rootDirectory,
    participantId: "agent/b",
  });
  assert.notEqual(a.cwd, b.cwd);
  assert.equal(a.cwd, agentExecutionWorkspacePath(rootDirectory, "agent/a"));
  assert.match(a.cwd, /\/[a-f0-9]{64}$/);
  assert.equal((await lstat(a.cwd)).mode & 0o077, 0);
  await assert.rejects(lstat(join(a.cwd, "MEMORY.md")), { code: "ENOENT" });
});

test("quarantine retry and rollback preserve files and other Agent workspaces", async (t) => {
  const rootDirectory = join(await fixture(t), "execution");
  const a = await prepareAgentExecutionWorkspace({
    rootDirectory,
    participantId: "a",
  });
  const b = await prepareAgentExecutionWorkspace({
    rootDirectory,
    participantId: "b",
  });
  await writeFile(join(a.cwd, "result"), "a");
  await writeFile(join(b.cwd, "result"), "b");
  const input = { rootDirectory, participantId: "a", operationId: "reset-1" };
  await quarantineAgentExecutionWorkspace(input);
  await assert.rejects(lstat(a.cwd), { code: "ENOENT" });
  const retry = await quarantineAgentExecutionWorkspace(input);
  await retry.rollback();
  await retry.rollback();
  assert.equal(await readFile(join(a.cwd, "result"), "utf8"), "a");
  const committed = await quarantineAgentExecutionWorkspace(input);
  await committed.commit();
  await committed.rollback();
  await assert.rejects(lstat(a.cwd), { code: "ENOENT" });
  assert.equal(await readFile(join(b.cwd, "result"), "utf8"), "b");
});

test("root, participant and ancestor symlinks cannot redirect execution writes", async (t) => {
  const base = await fixture(t);
  const actual = join(base, "actual");
  await mkdir(actual, { mode: 0o700 });
  const alias = join(base, "alias");
  await symlink(actual, alias);
  await assert.rejects(
    prepareAgentExecutionWorkspace({
      rootDirectory: alias,
      participantId: "a",
    }),
    /symlink/,
  );
  await assert.rejects(
    prepareAgentExecutionWorkspace({
      rootDirectory: join(alias, "child"),
      participantId: "a",
    }),
    /symlink/,
  );
  const rootDirectory = join(base, "execution");
  await mkdir(rootDirectory, { mode: 0o700 });
  await symlink(actual, agentExecutionWorkspacePath(rootDirectory, "a"));
  await assert.rejects(
    prepareAgentExecutionWorkspace({ rootDirectory, participantId: "a" }),
    /symlink/,
  );
  await assert.rejects(
    quarantineAgentExecutionWorkspace({
      rootDirectory,
      participantId: "a",
      operationId: "reset",
    }),
    /symlink/,
  );
});

test("rollback never overwrites a newly created execution directory", async (t) => {
  const rootDirectory = join(await fixture(t), "execution");
  await prepareAgentExecutionWorkspace({ rootDirectory, participantId: "a" });
  const q = await quarantineAgentExecutionWorkspace({
    rootDirectory,
    participantId: "a",
    operationId: "reset",
  });
  await assert.rejects(
    prepareAgentExecutionWorkspace({ rootDirectory, participantId: "a" }),
    /pending reset/,
  );
  await mkdir(agentExecutionWorkspacePath(rootDirectory, "a"), { mode: 0o700 });
  await assert.rejects(q.rollback(), /overwrite/);
  await assert.rejects(
    quarantineAgentExecutionWorkspace({
      rootDirectory,
      participantId: "a",
      operationId: "reset",
    }),
    /both/,
  );
});

test("empty reset is harmless and quarantine symlinks are rejected", async (t) => {
  const base = await fixture(t);
  const rootDirectory = join(base, "execution");
  const empty = await quarantineAgentExecutionWorkspace({
    rootDirectory,
    participantId: "absent",
    operationId: "reset",
  });
  await empty.rollback();
  await empty.commit();
  await rm(join(rootDirectory, ".quarantine"), { recursive: true });
  await mkdir(join(base, "outside"), { mode: 0o700 });
  await symlink(join(base, "outside"), join(rootDirectory, ".quarantine"));
  await assert.rejects(
    quarantineAgentExecutionWorkspace({
      rootDirectory,
      participantId: "a",
      operationId: "reset",
    }),
    /symlink/,
  );
});

test("unsafe identities and non-private execution roots are rejected", async (t) => {
  const rootDirectory = join(await fixture(t), "execution");
  assert.throws(() => agentExecutionWorkspacePath("relative", "a"), /absolute/);
  assert.throws(
    () => agentExecutionWorkspacePath(rootDirectory, ""),
    /identity/,
  );
  assert.throws(
    () => agentExecutionWorkspacePath(rootDirectory, "a\u0000b"),
    /identity/,
  );
  await mkdir(rootDirectory, { mode: 0o755 });
  await assert.rejects(
    prepareAgentExecutionWorkspace({ rootDirectory, participantId: "a" }),
    /private/,
  );
});
