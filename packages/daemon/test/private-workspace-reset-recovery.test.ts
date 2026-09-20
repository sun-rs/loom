import assert from "node:assert/strict";
import {
  mkdtemp,
  realpath,
  mkdir,
  readdir,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  AgentMemoryCoordinator,
  AgentExecutionWorkspaceCatalog,
  readAgentExecutionResetReceipt,
} from "@rah-os/agent-host";
import { RoomKernel } from "@rah-os/kernel";
import type {
  HostExecutionWorkspaceBinding,
  WorkspaceMountDescriptor,
} from "@rah-os/protocol";
import { createDaemonAgentExecutionResetCoordinator } from "../src/daemon-application-support.ts";

async function fixture(t: TestContext, privateWorkspace = true) {
  const stateDirectory = await mkdtemp(
    join(await realpath(tmpdir()), "rah-reset-recovery-"),
  );
  let now = Date.parse("2026-09-11T00:00:00.000Z");
  const databasePath = join(stateDirectory, "room.db");
  const kernelOptions = { databasePath, now: () => new Date(now) };
  let kernel = new RoomKernel(kernelOptions);
  kernel.initialize();
  const principal = kernel.provisionPrincipal({
    kind: "agent",
    handle: "reset-agent",
  }).principal;
  const credential = kernel.provisionHostCredential({
    hostId: "reset-host",
    participantIds: [principal.principalId],
  });
  let host = kernel.authenticateHostAccessToken(credential.accessToken);
  kernel.heartbeatHost(host);
  const memoryRoot = join(stateDirectory, "memory");
  let memory = new AgentMemoryCoordinator({
    rootDirectory: memoryRoot,
    wake: () => false,
  });
  t.after(async () => {
    await memory.close();
    kernel.close();
    await rm(stateDirectory, { recursive: true, force: true });
  });
  const legacyCwd = join(stateDirectory, "legacy-project");
  await mkdir(legacyCwd);
  const legacyMount: WorkspaceMountDescriptor = {
    workspaceDefinitionId: "workspace",
    workspaceMountRevisionId: "legacy",
    workspaceMountDigest: `sha256:${"a".repeat(64)}`,
    modes: ["in_place"],
  };
  const binding: HostExecutionWorkspaceBinding = {
    participantId: principal.principalId,
    agentDefinitionRevisionId: "revision",
    workspaceDefinitionId: "workspace",
    ...(privateWorkspace
      ? { executionWorkspace: { kind: "agent_private" as const } }
      : {}),
  };
  const receiptRoot = join(
    stateDirectory,
    "supervisors",
    "agent-execution-reset",
  );
  const options = {
    rootDirectory: join(stateDirectory, "execution"),
    legacyCwd,
    legacyMount,
    isResetCommitted: async (owner: string, operationId: string) => {
      const receipt = await readAgentExecutionResetReceipt(
        receiptRoot,
        operationId,
      );
      return (
        receipt?.mode === "full" &&
        receipt.ownerParticipantId === owner &&
        receipt.operationId === operationId
      );
    },
  };
  let catalog = await AgentExecutionWorkspaceCatalog.open(options);
  await catalog.refresh([binding]);
  const cwd = await catalog.projectDirectory(principal.principalId);
  assert.ok(cwd);
  await writeFile(join(cwd, "original.txt"), "original work");
  const input = {
    agentId: "definition-reset",
    mode: "full" as const,
    operationId: "reset-operation",
    ownerParticipantId: principal.principalId,
  };
  const coordinator = () =>
    createDaemonAgentExecutionResetCoordinator({
      executionWorkspaces: catalog,
      agentMemoryCoordinator: memory,
      host,
      kernel,
      stateDirectory,
    });
  return {
    input,
    options,
    binding,
    cwd,
    coordinator,
    get catalog() {
      return catalog;
    },
    get kernel() {
      return kernel;
    },
    async restart() {
      await memory.close();
      kernel.close();
      now += 120_000;
      kernel = new RoomKernel(kernelOptions);
      kernel.initialize();
      host = kernel.authenticateHostAccessToken(credential.accessToken);
      kernel.heartbeatHost(host, { takeoverAfterMs: 30_000 });
      memory = new AgentMemoryCoordinator({
        rootDirectory: memoryRoot,
        wake: () => false,
      });
      catalog = await AgentExecutionWorkspaceCatalog.open(options);
    },
  };
}

async function quarantinedOriginal(root: string) {
  const directory = join(root, ".quarantine");
  const entries = await readdir(directory, { withFileTypes: true });
  const moved = entries.find((entry) => entry.isDirectory());
  assert.ok(moved);
  return await readFile(join(directory, moved.name, "original.txt"), "utf8");
}

test("committed reset replays after restart, finalizes quarantine and releases the original fence", async (t) => {
  const f = await fixture(t);
  const originalQuarantine = f.catalog.quarantinePrivate.bind(f.catalog);
  const fault = new Error(
    "crash after completion receipt before execution finalize",
  );
  t.mock.method(
    f.catalog,
    "quarantinePrivate",
    async (owner: string, operation: string) => {
      const lease = await originalQuarantine(owner, operation);
      assert.ok(lease);
      return {
        ...lease,
        commit: () => {
          throw fault;
        },
      };
    },
  );
  const coordinator = f.coordinator();
  await assert.rejects(coordinator.reset(f.input), (error) => error === fault);
  assert.ok(await coordinator.receipt(f.input.operationId));
  assert.equal(
    f.kernel.getAgentExclusiveOperationLease(f.input.operationId).state,
    "active",
  );
  assert.equal(
    await quarantinedOriginal(f.options.rootDirectory),
    "original work",
  );
  await f.restart();
  const receipt = await f.coordinator().reset(f.input);
  assert.equal(receipt.deduplicated, true);
  assert.equal(
    f.kernel.getAgentExclusiveOperationLease(f.input.operationId).state,
    "released",
  );
  const mounts = await f.catalog.refresh([f.binding]);
  assert.equal(mounts.length, 2);
  assert.equal(
    await f.catalog.projectDirectory(f.input.ownerParticipantId),
    f.cwd,
  );
  await assert.rejects(readFile(join(f.cwd, "original.txt")), {
    code: "ENOENT",
  });
  assert.equal(
    await quarantinedOriginal(f.options.rootDirectory),
    "original work",
  );
});

test("uncommitted pending quarantine stays unavailable across restart and keeps original files", async (t) => {
  const f = await fixture(t);
  await f.catalog.quarantinePrivate(
    f.input.ownerParticipantId,
    f.input.operationId,
  );
  assert.equal(await f.coordinator().receipt(f.input.operationId), null);
  await f.restart();
  assert.deepEqual(await f.catalog.refresh([f.binding]), [
    f.options.legacyMount,
  ]);
  assert.equal(
    await f.catalog.projectDirectory(f.input.ownerParticipantId),
    undefined,
  );
  await assert.rejects(readFile(join(f.cwd, "original.txt")), {
    code: "ENOENT",
  });
  assert.equal(
    await quarantinedOriginal(f.options.rootDirectory),
    "original work",
  );
});

test("full reset preserves legacy project files, including receipt replay after restart", async (t) => {
  const f = await fixture(t, false);
  await f.coordinator().reset(f.input);
  assert.equal(
    await readFile(join(f.cwd, "original.txt"), "utf8"),
    "original work",
  );
  await f.restart();
  assert.equal((await f.coordinator().reset(f.input)).deduplicated, true);
  assert.equal(
    await readFile(join(f.cwd, "original.txt"), "utf8"),
    "original work",
  );
  assert.deepEqual(await f.catalog.refresh([f.binding]), [
    f.options.legacyMount,
  ]);
});
