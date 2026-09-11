import assert from "node:assert/strict";
import {
  mkdtemp,
  realpath,
  rm,
  symlink,
  mkdir,
  lstat,
  readdir,
  readFile,
  writeFile,
  utimes,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type {
  HostExecutionWorkspaceBinding,
  WorkspaceMountDescriptor,
} from "@rah-os/protocol";
import { AgentExecutionWorkspaceCatalog } from "../src/agent-execution-workspace-catalog.ts";
import { agentExecutionWorkspacePath } from "../src/agent-execution-workspace.ts";
const legacyMount: WorkspaceMountDescriptor = {
  workspaceDefinitionId: "workspace",
  workspaceMountRevisionId: "legacy",
  workspaceMountDigest: `sha256:${"a".repeat(64)}`,
  modes: ["in_place"],
};
function binding(id: string, privateCwd = true): HostExecutionWorkspaceBinding {
  return {
    participantId: id,
    agentDefinitionRevisionId: `revision-${id}`,
    workspaceDefinitionId: "workspace",
    ...(privateCwd
      ? { executionWorkspace: { kind: "agent_private" as const } }
      : {}),
  };
}
async function fixture(t: TestContext) {
  const base = await mkdtemp(join(await realpath(tmpdir()), "cwd-catalog-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  return {
    rootDirectory: join(base, "execution"),
    legacyCwd: join(base, "untouched-project"),
    legacyMount,
  };
}
test("catalog isolates private owners and preserves legacy without materializing it", async (t) => {
  const options = await fixture(t);
  const catalog = await AgentExecutionWorkspaceCatalog.open(options);
  const mounts = await catalog.refresh([
    binding("a"),
    binding("b"),
    binding("old", false),
  ]);
  assert.equal(mounts.length, 3);
  assert.deepEqual(mounts[0], legacyMount);
  assert.notEqual(
    await catalog.projectDirectory("a"),
    await catalog.projectDirectory("b"),
  );
  assert.equal(await catalog.projectDirectory("old"), options.legacyCwd);
  assert.equal(await catalog.projectDirectory("unknown"), undefined);
  await assert.rejects(lstat(options.legacyCwd), { code: "ENOENT" });
  assert.equal(await catalog.quarantinePrivate("old", "reset"), undefined);
  assert.throws(
    () => catalog.resolve({ ...legacyMount, participantId: "a" }),
    /binding|mount/,
  );
});
test("frozen receipts survive restart and binding changes, reject spoofing and symlinks", async (t) => {
  const options = await fixture(t);
  const first = await AgentExecutionWorkspaceCatalog.open(options);
  const mounts = await first.refresh([binding("a")]);
  const mount = mounts[1]!;
  const cwd = first.resolve({ ...mount, participantId: "a" });
  const next = await AgentExecutionWorkspaceCatalog.open(options);
  await next.refresh([]);
  assert.equal(next.resolve({ ...mount, participantId: "a" }), cwd);
  assert.throws(
    () => next.resolve({ ...mount, participantId: "b" }),
    /mount|receipt/,
  );
  assert.throws(
    () =>
      next.resolve({
        ...mount,
        participantId: "a",
        workspaceMountDigest: `sha256:${"b".repeat(64)}`,
      }),
    /mount|receipt/,
  );
  await rm(cwd, { recursive: true });
  await mkdir(options.legacyCwd);
  await symlink(options.legacyCwd, cwd);
  assert.throws(
    () => next.resolve({ ...mount, participantId: "a" }),
    /symlink/,
  );
  await assert.rejects(AgentExecutionWorkspaceCatalog.open(options), /symlink/);
});
test("failed private prepare never publishes or falls back to legacy", async (t) => {
  const options = await fixture(t);
  const catalog = await AgentExecutionWorkspaceCatalog.open(options);
  await mkdir(options.legacyCwd);
  await symlink(
    options.legacyCwd,
    agentExecutionWorkspacePath(options.rootDirectory, "a"),
  );
  const mounts = await catalog.refresh([binding("a"), binding("healthy")]);
  assert.deepEqual(
    mounts.map((m) => m.participantId),
    [undefined, "healthy"],
  );
  assert.equal(catalog.failures[0]?.participantId, "a");
  assert.ok(await catalog.projectDirectory("healthy"));
  assert.equal(await catalog.projectDirectory("a"), undefined);
  assert.throws(
    () => catalog.resolve({ ...legacyMount, participantId: "a" }),
    /binding|mount/,
  );
});

test("reset gap preserves receipts without recreating cwd until refresh", async (t) => {
  const options = await fixture(t);
  const first = await AgentExecutionWorkspaceCatalog.open(options);
  const mounts = await first.refresh([binding("a")]);
  const mount = mounts[1]!;
  const cwd = first.resolve({ ...mount, participantId: "a" });
  const reset = await first.quarantinePrivate("a", "reset");
  assert.ok(reset);
  reset.commit();
  const restarted = await AgentExecutionWorkspaceCatalog.open(options);
  await assert.rejects(lstat(cwd), { code: "ENOENT" });
  assert.throws(() => restarted.resolve({ ...mount, participantId: "a" }));
  await restarted.refresh([binding("a")]);
  assert.equal(restarted.resolve({ ...mount, participantId: "a" }), cwd);
});

test("receipt tampering cannot redirect a frozen mount", async (t) => {
  const options = await fixture(t);
  const catalog = await AgentExecutionWorkspaceCatalog.open(options);
  await catalog.refresh([binding("a")]);
  const receiptRoot = join(options.rootDirectory, ".mount-receipts");
  const [file] = await readdir(receiptRoot);
  assert.ok(file);
  const path = join(receiptRoot, file);
  const receipt = JSON.parse(await readFile(path, "utf8"));
  receipt.cwd = options.legacyCwd;
  await writeFile(path, JSON.stringify(receipt));
  await assert.rejects(
    AgentExecutionWorkspaceCatalog.open(options),
    /provenance/,
  );
});

test("explicit existing mount is retained and never quarantined", async (t) => {
  const options = await fixture(t);
  const catalog = await AgentExecutionWorkspaceCatalog.open(options);
  const explicit = {
    ...binding("a", false),
    executionWorkspace: {
      kind: "existing_mount" as const,
      workspaceMountRevisionId: "legacy",
    },
  };
  assert.deepEqual(await catalog.refresh([explicit]), [legacyMount]);
  assert.equal(await catalog.projectDirectory("a"), options.legacyCwd);
  assert.equal(await catalog.quarantinePrivate("a", "reset"), undefined);
  assert.equal(
    catalog.resolve({ ...legacyMount, participantId: "a" }),
    options.legacyCwd,
  );
  await assert.rejects(lstat(options.legacyCwd), { code: "ENOENT" });
});

test("refresh retains unchanged ready roots while immediately revoking removed and changed owners", async (t) => {
  const options = await fixture(t);
  const catalog = await AgentExecutionWorkspaceCatalog.open(options);
  await catalog.refresh([
    binding("stable"),
    binding("removed"),
    binding("changed", false),
  ]);
  const stableRoot = await catalog.projectDirectory("stable");
  const pending = catalog.refresh([
    binding("stable"),
    binding("changed"),
    binding("new"),
  ]);
  // Capture during the first async filesystem prepare, before publication.
  const stableDuring = catalog.projectDirectory("stable");
  const removedDuring = catalog.projectDirectory("removed");
  const changedDuring = catalog.projectDirectory("changed");
  const newDuring = catalog.projectDirectory("new");
  try {
    assert.equal(await stableDuring, stableRoot);
    assert.equal(await removedDuring, undefined);
    assert.equal(await changedDuring, undefined);
    assert.equal(await newDuring, undefined);
  } finally {
    await pending;
  }
  assert.ok(await catalog.projectDirectory("new"));
  assert.notEqual(await catalog.projectDirectory("changed"), options.legacyCwd);
});

test("quarantine fences refresh recreation and preserves rollback while peers continue", async (t) => {
  const options = await fixture(t);
  const catalog = await AgentExecutionWorkspaceCatalog.open(options);
  await catalog.refresh([binding("a"), binding("b")]);
  const cwd = (await catalog.projectDirectory("a"))!;
  await writeFile(join(cwd, "original"), "keep");
  const pending = catalog.refresh([binding("a"), binding("b")]);
  const resetPromise = catalog.quarantinePrivate("a", "reset");
  await pending;
  const reset = await resetPromise;
  assert.ok(reset);
  const mounts = await catalog.refresh([binding("a"), binding("b")]);
  assert.equal(
    mounts.some((m) => m.participantId === "a"),
    false,
  );
  assert.ok(await catalog.projectDirectory("b"));
  assert.equal(await catalog.projectDirectory("a"), undefined);
  await assert.rejects(lstat(cwd), { code: "ENOENT" });
  await reset.rollback();
  await catalog.refresh([binding("a"), binding("b")]);
  assert.equal(await readFile(join(cwd, "original"), "utf8"), "keep");
});

test("only frozen recovery may resolve an exact prior legacy mount after private binding", async (t) => {
  const options = await fixture(t);
  const catalog = await AgentExecutionWorkspaceCatalog.open(options);
  await catalog.refresh([binding("a")]);
  const placement = { ...legacyMount, participantId: "a" };
  assert.throws(() => catalog.resolve(placement), /binding/);
  assert.equal(catalog.resolveFrozen(placement), options.legacyCwd);
  assert.throws(
    () =>
      catalog.resolveFrozen({
        ...placement,
        workspaceMountDigest: `sha256:${"c".repeat(64)}`,
      }),
    /mount/,
  );
});

test("failed rollback keeps refresh fenced until the same lease can restore", async (t) => {
  const options = await fixture(t);
  const catalog = await AgentExecutionWorkspaceCatalog.open(options);
  await catalog.refresh([binding("a"), binding("b")]);
  const cwd = (await catalog.projectDirectory("a"))!;
  await writeFile(join(cwd, "original"), "keep");
  const reset = await catalog.quarantinePrivate("a", "reset");
  assert.ok(reset);
  await mkdir(cwd, { mode: 0o700 });
  await assert.rejects(reset.rollback(), /overwrite/);
  const mounts = await catalog.refresh([binding("a"), binding("b")]);
  assert.equal(
    mounts.some((m) => m.participantId === "a"),
    false,
  );
  assert.equal(await catalog.projectDirectory("a"), undefined);
  await rm(cwd, { recursive: true });
  await reset.rollback();
  assert.equal(await readFile(join(cwd, "original"), "utf8"), "keep");
});

test("unknown or failed private owner reset cannot report legacy success", async (t) => {
  const options = await fixture(t);
  const catalog = await AgentExecutionWorkspaceCatalog.open(options);
  await catalog.refresh([binding("a"), binding("old", false)]);
  const cwd = (await catalog.projectDirectory("a"))!;
  await rm(cwd, { recursive: true });
  await mkdir(options.legacyCwd);
  await symlink(options.legacyCwd, cwd);
  await catalog.refresh([binding("a"), binding("old", false)]);
  await assert.rejects(catalog.quarantinePrivate("a", "reset"), /authorized/);
  await assert.rejects(
    catalog.quarantinePrivate("unknown", "reset"),
    /authorized/,
  );
  assert.equal(await catalog.quarantinePrivate("old", "reset"), undefined);
});

test("same failed reset may finish its fenced operation after binding revocation", async (t) => {
  const options = await fixture(t);
  const catalog = await AgentExecutionWorkspaceCatalog.open(options);
  await catalog.refresh([binding("a")]);
  const cwd = (await catalog.projectDirectory("a"))!;
  await writeFile(join(cwd, "original"), "keep");
  await mkdir(options.legacyCwd);
  const quarantineRoot = join(options.rootDirectory, ".quarantine");
  await symlink(options.legacyCwd, quarantineRoot);
  await assert.rejects(catalog.quarantinePrivate("a", "reset"), /symlink/);
  await catalog.refresh([]);
  await assert.rejects(
    catalog.quarantinePrivate("a", "other"),
    /authorized|progress/,
  );
  await rm(quarantineRoot);
  const retry = await catalog.quarantinePrivate("a", "reset");
  assert.ok(retry);
  await retry.rollback();
  assert.equal(await readFile(join(cwd, "original"), "utf8"), "keep");
  assert.equal(await catalog.projectDirectory("a"), undefined);
});

test("unchanged heartbeat reuses durable receipt without directory writes", async (t) => {
  const options = await fixture(t);
  const catalog = await AgentExecutionWorkspaceCatalog.open(options);
  const first = await catalog.refresh([binding("a")]);
  const receiptRoot = join(options.rootDirectory, ".mount-receipts");
  const epoch = new Date("2000-01-01T00:00:00Z");
  await utimes(receiptRoot, epoch, epoch);
  assert.deepEqual(await catalog.refresh([binding("a")]), first);
  assert.equal((await lstat(receiptRoot)).mtimeMs, epoch.getTime());
});

test("pending reset survives catalog restart without recreating or publishing cwd", async (t) => {
  const options = await fixture(t);
  const first = await AgentExecutionWorkspaceCatalog.open(options);
  const mounts = await first.refresh([binding("a")]);
  const cwd = (await first.projectDirectory("a"))!;
  await first.quarantinePrivate("a", "pending-reset");
  const restarted = await AgentExecutionWorkspaceCatalog.open(options);
  assert.equal((await restarted.refresh([binding("a")])).length, 1);
  await assert.rejects(lstat(cwd), { code: "ENOENT" });
  assert.throws(() => restarted.resolve({ ...mounts[1]!, participantId: "a" }));
  const lease = await restarted.quarantinePrivate("a", "pending-reset");
  assert.ok(lease);
  await lease.rollback();
  assert.equal((await restarted.refresh([binding("a")])).length, 2);
});

test("authoritative completed reset receipt converges pending filesystem commit on restart", async (t) => {
  const options = await fixture(t);
  const first = await AgentExecutionWorkspaceCatalog.open(options);
  await first.refresh([binding("a")]);
  await first.quarantinePrivate("a", "done-reset");
  const seen: string[] = [];
  const restarted = await AgentExecutionWorkspaceCatalog.open({
    ...options,
    isResetCommitted: async (owner: string, op: string) => {
      seen.push(`${owner}/${op}`);
      return true;
    },
  });
  assert.deepEqual([...new Set(seen)], ["a/done-reset"]);
  assert.equal((await restarted.refresh([binding("a")])).length, 2);
  const again = await AgentExecutionWorkspaceCatalog.open(options);
  assert.equal((await again.refresh([binding("a")])).length, 2);
});

test("authoritative finalize never renames recreated cwd and rejects missing business decision", async (t) => {
  const options = await fixture(t);
  let committed = false;
  const catalog = await AgentExecutionWorkspaceCatalog.open({
    ...options,
    isResetCommitted: async () => committed,
  });
  await catalog.refresh([binding("a")]);
  const cwd = (await catalog.projectDirectory("a"))!;
  const lease = await catalog.quarantinePrivate("a", "op");
  assert.ok(lease);
  await assert.rejects(catalog.finalizeCommitted("a", "op"), /authoritative/);
  await mkdir(cwd, { mode: 0o700 });
  await writeFile(join(cwd, "new"), "preserve");
  committed = true;
  await catalog.finalizeCommitted("a", "op");
  assert.equal(await readFile(join(cwd, "new"), "utf8"), "preserve");
  await lease.rollback();
  assert.equal((await catalog.refresh([binding("a")])).length, 2);
});

test("replaying completed older reset cannot finalize a newer pending reset", async (t) => {
  const options = await fixture(t);
  const catalog = await AgentExecutionWorkspaceCatalog.open({
    ...options,
    isResetCommitted: async (_owner, op) => op === "op1",
  });
  await catalog.refresh([binding("a")]);
  const first = await catalog.quarantinePrivate("a", "op1");
  assert.ok(first);
  first.commit();
  await catalog.refresh([binding("a")]);
  const second = await catalog.quarantinePrivate("a", "op2");
  assert.ok(second);
  await catalog.finalizeCommitted("a", "op1");
  await assert.rejects(
    catalog.finalizeCommitted("a", "unknown"),
    /authoritative/,
  );
  assert.equal((await catalog.refresh([binding("a")])).length, 1);
  assert.equal(await catalog.projectDirectory("a"), undefined);
  const restarted = await AgentExecutionWorkspaceCatalog.open(options);
  assert.equal((await restarted.refresh([binding("a")])).length, 1);
  await second.rollback();
});
