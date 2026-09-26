import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
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
import { agentExecutionWorkspacePath } from "../src/agent-execution-workspace.ts";

/**
 * Owner 2026-09-26 channel workspace on the Host: one platform-created home
 * per Channel (the cwd of all its channel-home instances), never reused for a
 * foreign directory, never removed by an instance reset.
 */
const legacyMount: WorkspaceMountDescriptor = {
  workspaceDefinitionId: "workspace",
  workspaceMountRevisionId: "legacy",
  workspaceMountDigest: `sha256:${"a".repeat(64)}`,
  modes: ["in_place"],
};
function channelBinding(
  id: string,
  roomId: string,
  additionalDirectories: string[] = [],
): HostExecutionWorkspaceBinding {
  return {
    participantId: id,
    agentDefinitionRevisionId: `revision-${id}`,
    workspaceDefinitionId: "workspace",
    executionWorkspace: { kind: "channel_home", roomId },
    additionalDirectories,
  };
}
async function fixture(t: TestContext) {
  const base = await mkdtemp(join(await realpath(tmpdir()), "channel-home-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  // Attached directories must exist: the Host re-checks them at refresh.
  const app = join(base, "work", "app");
  const lib = join(base, "work", "lib");
  await mkdir(app, { recursive: true });
  await mkdir(lib, { recursive: true });
  return {
    base,
    app,
    lib,
    options: {
      rootDirectory: join(base, "state", "agent-workspaces"),
      channelHomeRoot: join(base, "channel-workspaces"),
      legacyCwd: join(base, "untouched-project"),
      legacyMount,
    },
  };
}
const mountOf = (mounts: WorkspaceMountDescriptor[], id: string) => {
  const mount = mounts.find((m) => m.participantId === id);
  assert.ok(mount, `mount for ${id}`);
  return { ...mount, participantId: id };
};

test("instances of one Channel share its newly created home with per-instance mounts; the home root is lazy", async (t) => {
  const { options, app } = await fixture(t);
  const catalog = await AgentExecutionWorkspaceCatalog.open(options);
  await catalog.refresh([]);
  await assert.rejects(lstat(options.channelHomeRoot), { code: "ENOENT" });
  const mounts = await catalog.refresh([
    channelBinding("a", "room-1", [app]),
    channelBinding("b", "room-1", [app]),
    channelBinding("c", "room-2"),
  ]);
  assert.deepEqual(catalog.failures, []);
  const home = join(options.channelHomeRoot, "room-1");
  const a = mountOf(mounts, "a");
  const b = mountOf(mounts, "b");
  assert.notEqual(a.workspaceMountRevisionId, b.workspaceMountRevisionId);
  assert.deepEqual(catalog.resolveWorkspace(a), {
    cwd: home,
    additionalDirectories: [app],
  });
  assert.equal(catalog.resolve(b), home);
  assert.equal(
    catalog.resolve(mountOf(mounts, "c")),
    join(options.channelHomeRoot, "room-2"),
  );
  assert.ok((await lstat(home)).isDirectory());
  assert.equal(await catalog.projectDirectory("a"), home);
  assert.equal(await catalog.channelHomeDirectory("a"), home);
  assert.deepEqual(await catalog.attachedDirectories("a"), [app]);
  assert.deepEqual(await catalog.attachedDirectories("c"), []);
});

test("a directory already at the home path that Loom did not create is never reused", async (t) => {
  const { options } = await fixture(t);
  await mkdir(join(options.channelHomeRoot, "room-1"), { recursive: true });
  const catalog = await AgentExecutionWorkspaceCatalog.open(options);
  const mounts = await catalog.refresh([channelBinding("a", "room-1")]);
  assert.equal(
    mounts.some((m) => m.participantId === "a"),
    false,
  );
  assert.match(catalog.failures[0]?.message ?? "", /not created by Loom/u);
});

test("the home survives restart and an instance reset; a changed attached set is a new mount", async (t) => {
  const { options, app, lib } = await fixture(t);
  const first = await AgentExecutionWorkspaceCatalog.open(options);
  const before = mountOf(
    await first.refresh([channelBinding("a", "room-1", [app])]),
    "a",
  );
  const home = first.resolve(before);
  await writeFile(join(home, "product.txt"), "kept");
  assert.equal(await first.quarantinePrivate("a", "reset-1"), undefined);
  assert.equal(await readFile(join(home, "product.txt"), "utf8"), "kept");

  const next = await AgentExecutionWorkspaceCatalog.open(options);
  await next.refresh([]);
  assert.equal(next.resolve(before), home, "frozen receipt after restart");
  const again = mountOf(
    await next.refresh([channelBinding("a", "room-1", [app])]),
    "a",
  );
  assert.deepEqual(next.failures, []);
  assert.equal(again.workspaceMountRevisionId, before.workspaceMountRevisionId);
  const changed = mountOf(
    await next.refresh([channelBinding("a", "room-1", [lib])]),
    "a",
  );
  assert.notEqual(
    changed.workspaceMountRevisionId,
    before.workspaceMountRevisionId,
  );
  assert.equal(await readFile(join(home, "product.txt"), "utf8"), "kept");
});

test("a private-cwd instance keeps exactly its previous cwd beside channel homes", async (t) => {
  const { options } = await fixture(t);
  const catalog = await AgentExecutionWorkspaceCatalog.open(options);
  const mounts = await catalog.refresh([
    {
      participantId: "old",
      agentDefinitionRevisionId: "revision-old",
      workspaceDefinitionId: "workspace",
      executionWorkspace: { kind: "agent_private" },
    },
    channelBinding("new", "room-1"),
  ]);
  assert.equal(
    catalog.resolve(mountOf(mounts, "old")),
    agentExecutionWorkspacePath(options.rootDirectory, "old"),
  );
  assert.deepEqual(catalog.resolveWorkspace(mountOf(mounts, "old")), {
    cwd: agentExecutionWorkspacePath(options.rootDirectory, "old"),
    additionalDirectories: [],
  });
  assert.equal(
    catalog.resolve(mountOf(mounts, "new")),
    join(options.channelHomeRoot, "room-1"),
  );
  assert.equal(
    await catalog.channelHomeDirectory("old"),
    undefined,
    "a private cwd is not exposed as a channel browsing root",
  );
});

test("without a configured home root a channel-home binding fails visibly", async (t) => {
  const { options } = await fixture(t);
  const { channelHomeRoot: _unused, ...withoutRoot } = options;
  const catalog = await AgentExecutionWorkspaceCatalog.open(withoutRoot);
  await catalog.refresh([channelBinding("a", "room-1")]);
  assert.match(catalog.failures[0]?.message ?? "", /channel home root/u);
});
