import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type {
  HostExecutionWorkspaceBinding,
  WorkspaceMountDescriptor,
} from "@rah-os/protocol";
import { AgentExecutionWorkspaceCatalog } from "../src/agent-execution-workspace-catalog.ts";
import { AgentMemoryCoordinator } from "../src/agent-memory-coordinator.ts";
import { reservedChannelDirectories } from "../src/channel-directory-check.ts";
import { createChannelHome } from "../src/channel-home-records.ts";

/**
 * Review 2026-09-26 (P1-1, P2-1): a Channel's primary and attached
 * directories are re-verified against the directory that was approved or
 * created (canonical path, no symlink, outside Loom data, same dev/ino)
 * before every binding refresh, launch resolution and file browse. A
 * mismatch is refused; nothing follows a replacement or silently recreates
 * an empty home. Temporary directories only.
 */
const legacyMount: WorkspaceMountDescriptor = {
  workspaceDefinitionId: "workspace",
  workspaceMountRevisionId: "legacy",
  workspaceMountDigest: `sha256:${"a".repeat(64)}`,
  modes: ["in_place"],
};
function binding(
  id: string,
  roomId: string,
  additionalDirectories: string[] = [],
  primaryDirectory?: string,
): HostExecutionWorkspaceBinding {
  return {
    participantId: id,
    agentDefinitionRevisionId: `revision-${id}`,
    workspaceDefinitionId: "workspace",
    executionWorkspace: { kind: "channel_home", roomId },
    additionalDirectories,
    ...(primaryDirectory === undefined ? {} : { primaryDirectory }),
  };
}
async function fixture(t: TestContext) {
  const base = await mkdtemp(join(await realpath(tmpdir()), "channel-dirs-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const state = join(base, "state");
  const homes = join(base, "homes");
  const app = join(base, "work", "app");
  await mkdir(app, { recursive: true });
  await mkdir(state, { recursive: true });
  await writeFile(join(app, "main.ts"), "approved");
  await writeFile(join(state, "internal.md"), "NOT IN APPROVED ROOT");
  const options = {
    rootDirectory: join(state, "agent-workspaces"),
    channelHomeRoot: homes,
    reservedDirectories: reservedChannelDirectories({
      stateDirectory: state,
      channelWorkspaceRoot: homes,
    }),
    legacyCwd: join(base, "untouched-project"),
    legacyMount,
  };
  const catalog = await AgentExecutionWorkspaceCatalog.open(options);
  const coordinator = new AgentMemoryCoordinator({
    rootDirectory: join(state, "agent-memory"),
    resolveProjectDirectory: async (owner) =>
      await catalog.channelHomeDirectory(owner),
    resolveAttachedDirectories: async (owner) =>
      await catalog.attachedDirectories(owner),
    verifyAttachedDirectory: (owner, directory) =>
      catalog.verifyAttachedDirectory(owner, directory),
    wake: () => false,
  });
  t.after(() => coordinator.close());
  return { base, state, homes, app, options, catalog, coordinator };
}
const mountOf = (mounts: WorkspaceMountDescriptor[], id: string) => {
  const mount = mounts.find((m) => m.participantId === id);
  assert.ok(mount, `mount for ${id}`);
  return { ...mount, participantId: id };
};
async function prepared(t: TestContext) {
  const f = await fixture(t);
  const mount = mountOf(
    await f.catalog.refresh([binding("a", "room-1", [f.app])]),
    "a",
  );
  assert.deepEqual(f.catalog.failures, []);
  assert.equal(
    (
      await f.coordinator.previewWorkspaceFile(
        "a",
        "attached-project-1",
        "main.ts",
      )
    ).content,
    "approved",
  );
  return { ...f, mount, home: join(f.homes, "room-1") };
}
async function assertAttachedRefused(
  f: Awaited<ReturnType<typeof prepared>>,
  file: string,
  reason: RegExp,
) {
  await assert.rejects(
    f.coordinator.previewWorkspaceFile("a", "attached-project-1", file),
    reason,
  );
  await assert.rejects(
    f.coordinator.browseWorkspace("a", "attached-project-1", "", true),
    reason,
  );
  assert.throws(() => f.catalog.resolveWorkspace(f.mount), reason);
  const mounts = await f.catalog.refresh([binding("a", "room-1", [f.app])]);
  assert.equal(
    mounts.some((m) => m.participantId === "a"),
    false,
    "a changed attached directory is not published as a mount",
  );
  assert.match(f.catalog.failures[0]?.message ?? "", reason);
}

test("P1-1: an attached root replaced by a symlink to Loom data is refused, never followed", async (t) => {
  const f = await prepared(t);
  await rename(f.app, `${f.app}-moved`);
  await symlink(f.state, f.app);
  await assertAttachedRefused(f, "internal.md", /attached_directory_symlink/u);
});

test("P1-1: an attached root whose ancestor was replaced by a symlink is refused", async (t) => {
  const f = await prepared(t);
  const work = join(f.base, "work");
  await rename(work, `${work}-real`);
  await symlink(`${work}-real`, work);
  await assertAttachedRefused(
    f,
    "main.ts",
    /attached_directory_not_canonical/u,
  );
});

test("P1-1: a deleted attached root is refused", async (t) => {
  const f = await prepared(t);
  await rm(f.app, { recursive: true });
  await assertAttachedRefused(f, "main.ts", /attached_directory_missing/u);
});

test("P1-1: a same-name ordinary directory put in place of the attached root is refused by its identity", async (t) => {
  const f = await prepared(t);
  await rename(f.app, `${f.app}-old`);
  await mkdir(f.app);
  await writeFile(join(f.app, "main.ts"), "foreign");
  await assertAttachedRefused(f, "main.ts", /attached_directory_replaced/u);
});

test("P1-1: an attached directory that overlaps Loom data is refused at binding refresh", async (t) => {
  const f = await fixture(t);
  const inside = join(f.state, "project");
  await mkdir(inside);
  const mounts = await f.catalog.refresh([binding("a", "room-1", [inside])]);
  assert.equal(
    mounts.some((m) => m.participantId === "a"),
    false,
  );
  assert.match(
    f.catalog.failures[0]?.message ?? "",
    /attached_directory_reserved/u,
  );
  await assert.rejects(lstat(join(f.homes, "room-1")), { code: "ENOENT" });
});

function intentPath(rootDirectory: string, roomId: string) {
  return join(
    rootDirectory,
    ".channel-homes",
    `${createHash("sha256").update(roomId).digest("hex")}.json`,
  );
}
async function writeIntent(rootDirectory: string, roomId: string, cwd: string) {
  await mkdir(join(rootDirectory, ".channel-homes"), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(
    intentPath(rootDirectory, roomId),
    JSON.stringify({ schemaVersion: 1, roomId, cwd }),
    { mode: 0o600 },
  );
}

test("P2-1: an intent without a completion record never adopts a directory that now exists", async (t) => {
  const f = await fixture(t);
  const home = join(f.homes, "room-1");
  await writeIntent(f.options.rootDirectory, "room-1", home);
  await mkdir(home, { recursive: true });
  await writeFile(join(home, "foreign.md"), "not Loom's");
  const mounts = await f.catalog.refresh([binding("a", "room-1")]);
  assert.equal(
    mounts.some((m) => m.participantId === "a"),
    false,
  );
  assert.match(f.catalog.failures[0]?.message ?? "", /channel_home_unowned/u);
  assert.deepEqual(f.catalog.channelHomeStates(), [
    {
      roomId: "room-1",
      state: "failed",
      reason: f.catalog.failures[0]!.message,
    },
  ]);
  assert.equal(await readFile(join(home, "foreign.md"), "utf8"), "not Loom's");
});

test("P2-1: an intent whose directory was never created is completed exactly once", async (t) => {
  const f = await fixture(t);
  const home = join(f.homes, "room-1");
  await writeIntent(f.options.rootDirectory, "room-1", home);
  const mount = mountOf(await f.catalog.refresh([binding("a", "room-1")]), "a");
  assert.deepEqual(f.catalog.failures, []);
  assert.equal(f.catalog.resolve(mount), home);
  assert.deepEqual(f.catalog.channelHomeStates(), [
    { roomId: "room-1", state: "ready" },
  ]);
});

test("P2-1: a primary directory replaced by an ordinary directory blocks refresh, launch resolution and browsing", async (t) => {
  const f = await prepared(t);
  await writeFile(join(f.home, "product.md"), "ours");
  await rename(f.home, `${f.home}-moved`);
  await mkdir(f.home);
  await writeFile(join(f.home, "foreign.md"), "foreign");
  assert.throws(
    () => f.catalog.resolveWorkspace(f.mount),
    /channel_home_replaced/u,
  );
  await assert.rejects(
    f.coordinator.previewWorkspaceFile("a", "runtime-project", "foreign.md"),
    /channel_home_replaced/u,
  );
  const mounts = await f.catalog.refresh([binding("a", "room-1", [f.app])]);
  assert.equal(
    mounts.some((m) => m.participantId === "a"),
    false,
  );
  assert.match(f.catalog.failures[0]?.message ?? "", /channel_home_replaced/u);
  assert.equal(f.catalog.channelHomeStates()[0]?.state, "failed");
});

test("P2-1: a deleted primary directory is reported, never silently recreated empty", async (t) => {
  const f = await prepared(t);
  await rm(f.home, { recursive: true });
  assert.throws(
    () => f.catalog.resolveWorkspace(f.mount),
    /channel_home_missing/u,
  );
  await f.catalog.refresh([binding("a", "room-1", [f.app])]);
  assert.match(f.catalog.failures[0]?.message ?? "", /channel_home_missing/u);
  await assert.rejects(lstat(f.home), { code: "ENOENT" });
  const restarted = await AgentExecutionWorkspaceCatalog.open(f.options);
  await restarted.refresh([binding("a", "room-1", [f.app])]);
  assert.match(restarted.failures[0]?.message ?? "", /channel_home_missing/u);
  await assert.rejects(lstat(f.home), { code: "ENOENT" });
});

test("P2-1: concurrent first preparation of one Channel from two catalogs creates one directory and adopts nothing foreign", async (t) => {
  const f = await fixture(t);
  const other = await AgentExecutionWorkspaceCatalog.open(f.options);
  await Promise.all([
    f.catalog.refresh([binding("a", "room-1", [f.app])]),
    other.refresh([binding("b", "room-1", [f.app])]),
  ]);
  const failed = [...f.catalog.failures, ...other.failures];
  assert.ok(failed.length <= 1, JSON.stringify(failed));
  const home = join(f.homes, "room-1");
  await writeFile(join(home, "product.md"), "shared");
  const a = mountOf(
    await f.catalog.refresh([binding("a", "room-1", [f.app])]),
    "a",
  );
  const b = mountOf(
    await other.refresh([binding("b", "room-1", [f.app])]),
    "b",
  );
  assert.deepEqual([...f.catalog.failures, ...other.failures], []);
  assert.equal(f.catalog.resolve(a), home);
  assert.equal(other.resolve(b), home);
  assert.equal(await readFile(join(home, "product.md"), "utf8"), "shared");
});

test("the primary directory recorded at Channel creation wins over the current home root", async (t) => {
  const f = await fixture(t);
  const recorded = join(f.base, "old-root", "room-1");
  const mount = mountOf(
    await f.catalog.refresh([binding("a", "room-1", [], recorded)]),
    "a",
  );
  assert.deepEqual(f.catalog.failures, []);
  assert.equal(f.catalog.resolve(mount), recorded);
  await assert.rejects(lstat(join(f.homes, "room-1")), { code: "ENOENT" });
  await f.catalog.refresh([
    binding("b", "room-1", [], join(f.base, "elsewhere", "room-1")),
  ]);
  assert.match(
    (f.catalog.failures as readonly { message: string }[])
      .map((failure) => failure.message)
      .join("\n"),
    /channel_home_path_mismatch/u,
  );
});

test("option A: the Host creates a Channel home at Channel creation; a catalog verifies it at the first binding; rollback removes only an untouched empty directory", async (t) => {
  const f = await fixture(t);
  const home = join(f.homes, "room-1");
  const created = createChannelHome({
    rootDirectory: f.options.rootDirectory,
    roomId: "room-1",
    defaultCwd: home,
  });
  assert.equal(created.primaryDirectory, home);
  assert.ok((await lstat(home)).isDirectory());
  const mount = mountOf(
    await f.catalog.refresh([binding("a", "room-1", [], home)]),
    "a",
  );
  assert.deepEqual(f.catalog.failures, []);
  assert.equal(f.catalog.resolve(mount), home);

  const second = join(f.homes, "room-2");
  createChannelHome({
    rootDirectory: f.options.rootDirectory,
    roomId: "room-2",
    defaultCwd: second,
  }).rollback();
  await assert.rejects(lstat(second), { code: "ENOENT" });
  await assert.rejects(lstat(intentPath(f.options.rootDirectory, "room-2")), {
    code: "ENOENT",
  });

  const third = join(f.homes, "room-3");
  const kept = createChannelHome({
    rootDirectory: f.options.rootDirectory,
    roomId: "room-3",
    defaultCwd: third,
  });
  await writeFile(join(third, "work.md"), "someone wrote here");
  kept.rollback();
  assert.equal(
    await readFile(join(third, "work.md"), "utf8"),
    "someone wrote here",
    "a non-empty directory is never removed",
  );
});

// Review 2026-09-26 minor fix: the attached directories' identities are
// recorded by the same Host preparation that creates the primary directory,
// so a directory replaced between Channel creation and the first binding is
// refused (it used to be adopted as the "first check").
test("option A: attached directory identities are recorded at Channel creation; a replacement before the first binding is refused", async (t) => {
  const f = await fixture(t);
  const home = join(f.homes, "room-1");
  createChannelHome({
    rootDirectory: f.options.rootDirectory,
    roomId: "room-1",
    defaultCwd: home,
    attachedDirectories: [f.app],
    reservedDirectories: f.options.reservedDirectories,
  });
  await rename(f.app, `${f.app}-old`);
  await mkdir(f.app);
  await writeFile(join(f.app, "main.ts"), "foreign");
  const mounts = await f.catalog.refresh([
    binding("a", "room-1", [f.app], home),
  ]);
  assert.equal(
    mounts.some((m) => m.participantId === "a"),
    false,
  );
  assert.match(
    f.catalog.failures[0]?.message ?? "",
    /attached_directory_replaced/u,
  );
});

test("option A: an attached directory rejected by the Host rules fails the preparation and leaves no records", async (t) => {
  const f = await fixture(t);
  const inside = join(f.state, "project");
  await mkdir(inside);
  const home = join(f.homes, "room-1");
  assert.throws(
    () =>
      createChannelHome({
        rootDirectory: f.options.rootDirectory,
        roomId: "room-1",
        defaultCwd: home,
        attachedDirectories: [inside],
        reservedDirectories: f.options.reservedDirectories,
      }),
    /attached_directory/u,
  );
  await assert.rejects(lstat(home), { code: "ENOENT" });
  await assert.rejects(lstat(intentPath(f.options.rootDirectory, "room-1")), {
    code: "ENOENT",
  });
});

test("option A: Channel home creation fails on an existing path or an unwritable parent, leaving no completion record", async (t) => {
  const f = await fixture(t);
  const taken = join(f.homes, "room-1");
  await mkdir(taken, { recursive: true });
  assert.throws(
    () =>
      createChannelHome({
        rootDirectory: f.options.rootDirectory,
        roomId: "room-1",
        defaultCwd: taken,
      }),
    /channel_home_unowned/u,
  );
  const locked = join(f.base, "locked");
  await mkdir(locked);
  await chmod(locked, 0o500);
  t.after(() => chmod(locked, 0o700).catch(() => undefined));
  assert.throws(
    () =>
      createChannelHome({
        rootDirectory: f.options.rootDirectory,
        roomId: "room-2",
        defaultCwd: join(locked, "room-2"),
      }),
    /EACCES|permission/iu,
  );
  await f.catalog.refresh([binding("a", "room-2", [], join(locked, "room-2"))]);
  assert.notDeepEqual(f.catalog.failures, [], "never adopted afterwards");
});
