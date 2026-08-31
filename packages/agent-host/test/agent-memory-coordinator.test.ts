import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AgentRuntimeContext } from "@rah-os/protocol";
import { RoomKernel } from "@rah-os/kernel";

import {
  AgentMemoryCoordinator,
  RAH_AGENT_APP_INBOX_JSON_ENV,
  createAgentMemoryResetFenceAcquirer,
  createKernelAgentHostControlPort,
} from "../src/index.ts";

function agent(participantId: string): AgentRuntimeContext {
  return {
    agentDefinitionRevision: {
      agentDefinitionId: `definition-${participantId}`,
      agentDefinitionRevisionId: `revision-${participantId}`,
      contentDigest: `sha256:${"1".repeat(64)}`,
      createdAt: "2026-08-30T09:00:00.000+08:00",
      createdBy: "human-owner",
      displayName: "Persistent Agent",
      executionPolicyRevisionId: "execution-full-access-v1",
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "memory-policy",
        contentDigest: `sha256:${"2".repeat(64)}`,
        versionId: "memory-policy-v1",
      },
      revision: 1,
      role: "Keeps private memory across Rooms",
      skillRefs: [],
    },
    handle: "persistent-agent",
    participantId,
    schemaVersion: 1,
  };
}

function activation(runAttemptId: string) {
  return {
    activationId: `activation-${runAttemptId}`,
    computerHostId: "memory-host",
    roomId: "memory-room",
    runAttemptId,
  };
}

test("Cleaner config survives persona revisions, reset and restart without changing memory or waking", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-config-owner-"));
  const rootDirectory = join(directory, "memory");
  let wakes = 0;
  const options = {
    rootDirectory,
    wake: () => {
      wakes += 1;
      return false;
    },
    acquireResetFence: async () => ({ release() {} }),
    quarantineProviderContinuity: async () => ({
      recordCount: 0,
      rollback() {},
    }),
  };
  const coordinator = new AgentMemoryCoordinator(options);
  try {
    coordinator.patchCleanerConfig("alice", {
      expectedRevision: 0,
      set: { enabled: false, threshold_bytes: 4096 },
    });
    const prepared = await coordinator.prepareActivation(
      agent("alice"),
      activation("one"),
    );
    await writeFile(prepared.memoryIndexPath, "x".repeat(5000));
    const revised = agent("alice");
    revised.agentDefinitionRevision.revision = 99;
    await coordinator.prepareActivation(revised, activation("two"));
    assert.equal(coordinator.getCleanerConfig("alice").revision, 1);
    assert.equal(
      (await coordinator.inspectWorkspace("alice")).thresholdBytes,
      4096,
    );
    assert.equal(
      (await coordinator.readWorkspaceFile("alice", "MEMORY.md")).content
        .length,
      5000,
    );
    assert.equal(wakes, 0);
    await coordinator.resetWorkspace("alice", "reset-config");
    assert.equal(
      coordinator.getCleanerConfig("alice").effective.enabled,
      false,
    );
    await coordinator.close();
    assert.throws(
      () =>
        coordinator.patchCleanerConfig("alice", {
          expectedRevision: 1,
          set: { enabled: true },
        }),
      /closed/,
    );
    const reopened = new AgentMemoryCoordinator(options);
    try {
      assert.equal(reopened.getCleanerConfig("alice").revision, 1);
    } finally {
      await reopened.close();
    }
  } finally {
    await coordinator.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Runtime memory lease exposes real private check/ack CLI and closes every capability with its Computer", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-cli-"));
  const coordinator = new AgentMemoryCoordinator({
    rootDirectory: join(directory, "memory"),
    wake: () => false,
  });
  try {
    const prepared = await coordinator.prepareRuntimeActivation(
      agent("alice-cli"),
      activation("alice-cli-run"),
      { cwd: directory },
    );
    const other = await coordinator.prepareRuntimeActivation(
      agent("bob-cli"),
      activation("bob-cli-run"),
      { cwd: directory },
    );
    const configCommand = async (lease: typeof prepared, args: string[]) =>
      JSON.parse(
        (
          await promisify(execFile)(
            lease.env.RAH_AGENT_INBOX_CLI!,
            ["app", "config", "--app", "system.cleaner", ...args],
            { env: { PATH: process.env.PATH, ...lease.env }, timeout: 5000 },
          )
        ).stdout,
      );
    assert.equal((await configCommand(prepared, [])).revision, 0);
    assert.equal(
      (
        await configCommand(prepared, [
          "--set",
          "threshold_bytes=131072",
          "--set",
          "interval_ms=900000",
        ])
      ).revision,
      1,
    );
    assert.equal((await configCommand(other, [])).revision, 0);
    assert.equal(
      (
        await configCommand(prepared, [
          "--unset",
          "threshold_bytes",
          "--unset",
          "interval_ms",
        ])
      ).revision,
      2,
    );
    await assert.rejects(configCommand(prepared, ["--set", "enabled=perhaps"]));
    const exec = async (lease: typeof prepared, args: string[]) =>
      JSON.parse(
        (
          await promisify(execFile)(
            lease.env.RAH_AGENT_INBOX_CLI!,
            ["agent", "inbox", ...args],
            { env: { PATH: process.env.PATH, ...lease.env }, timeout: 5_000 },
          )
        ).stdout,
      );
    const source = `# Memory\n${"durable knowledge\n".repeat(5_000)}`;
    await writeFile(prepared.memoryIndexPath, source);
    const checked = await exec(prepared, ["recheck"]);
    assert.equal(checked.measurement, "over_threshold");
    assert.equal(checked.items.length, 1);
    assert.equal((await exec(other, ["check"])).items.length, 0);
    const item = checked.items[0];
    assert.equal(
      (
        await exec(other, [
          "ack",
          "--item-id",
          item.itemId,
          "--version",
          String(item.version),
        ])
      ).acknowledged,
      false,
    );
    const ack = await exec(prepared, [
      "ack",
      "--item-id",
      item.itemId,
      "--version",
      String(item.version),
    ]);
    assert.equal(ack.acknowledged, true);
    assert.equal(
      ack.proofScope,
      "notification_acknowledged_not_memory_cleaned",
    );
    assert.equal(readFileSync(prepared.memoryIndexPath, "utf8"), source);
    await prepared.release?.();
    await assert.rejects(configCommand(prepared, []));
    await assert.rejects(exec(prepared, ["check"]));
    await coordinator.close();
    await assert.rejects(exec(other, ["check"]));
    await assert.rejects(
      coordinator.prepareRuntimeActivation(
        agent("alice-cli"),
        activation("late"),
        { cwd: directory },
      ),
    );
  } finally {
    await coordinator.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Reset rollback reapplies the latest committed cleaner config, never its stale pre-reset snapshot", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-cleaner-reset-race-"));
  const coordinator = new AgentMemoryCoordinator({
    rootDirectory: join(directory, "memory"),
    wake: () => false,
    acquireResetFence: async () => ({ release() {} }),
    quarantineProviderContinuity: async () => {
      coordinator.patchCleanerConfig("alice", {
        expectedRevision: 0,
        set: { enabled: false },
      });
      throw new Error("continuity failure");
    },
  });
  try {
    await coordinator.prepareActivation(agent("alice"), activation("race"));
    await assert.rejects(
      coordinator.resetWorkspace("alice", "race-reset"),
      /continuity failure/,
    );
    assert.equal(coordinator.getCleanerConfig("alice").revision, 1);
    assert.equal(
      (await coordinator.recheckInbox("alice")).measurement,
      "disabled",
    );
  } finally {
    await coordinator.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runtime source and explicit project aliases freeze outside the unchanged memory index", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-source-"));
  const rootDirectory = join(directory, "memory");
  const firstCwd = join(directory, "checkout-a");
  const secondCwd = join(directory, "checkout-b");
  const coordinator = new AgentMemoryCoordinator({
    rootDirectory,
    wake: () => false,
  });
  try {
    await mkdir(firstCwd);
    await mkdir(secondCwd);
    const seed = await coordinator.prepareActivation(
      agent("source-agent"),
      activation("source-seed"),
      { cwd: firstCwd },
    );
    assert.ok(
      seed.materializationReceipt.source,
      "Run receipt must retain actual launch source",
    );
    assert.equal(seed.materializationReceipt.source.resolution, "unconfigured");
    const original = readFileSync(seed.memoryIndexPath, "utf8");
    const configuration = {
      schemaVersion: 1,
      projects: [
        {
          key: "core",
          label: "Core",
          roots: [firstCwd, secondCwd],
          relatedKeys: [],
        },
      ],
    };
    const catalogPath = join(rootDirectory, ".project-bindings.json");
    await writeFile(catalogPath, JSON.stringify(configuration), {
      mode: 0o600,
    });
    const first = await coordinator.prepareActivation(
      agent("source-agent"),
      activation("source-first"),
      { cwd: firstCwd },
    );
    const encoded = first.env.RAH_AGENT_MEMORY_BOOTSTRAP_JSON!;
    assert.deepEqual(JSON.parse(encoded).project, {
      key: "core",
      label: "Core",
    });
    assert.ok(Buffer.byteLength(encoded) <= 4096);
    assert.equal(encoded.includes(directory), false);
    const sourceFile = first.env.RAH_AGENT_MEMORY_SOURCE_FILE;
    assert.ok(sourceFile);
    assert.deepEqual(
      JSON.parse(readFileSync(sourceFile, "utf8")).source,
      first.materializationReceipt.source,
    );
    assert.equal(first.materializationReceipt.source?.cwd, firstCwd);
    const second = await coordinator.prepareActivation(
      agent("source-agent"),
      activation("source-second"),
      { cwd: secondCwd },
    );
    assert.equal(second.env.RAH_AGENT_MEMORY_BOOTSTRAP_JSON, encoded);
    assert.equal(second.memoryIndexPath, first.memoryIndexPath);
    assert.equal(readFileSync(first.memoryIndexPath, "utf8"), original);
    await assert.rejects(
      coordinator.prepareActivation(
        agent("source-agent"),
        activation("source-first"),
        { cwd: secondCwd },
      ),
      /different memory index or identity/u,
    );
    const changed = {
      ...configuration,
      projects: [{ ...configuration.projects[0]!, label: "Renamed" }],
    };
    await writeFile(catalogPath, JSON.stringify(changed));
    await assert.rejects(
      coordinator.prepareActivation(
        agent("source-agent"),
        activation("source-first"),
        { cwd: firstCwd },
      ),
      /different memory index or identity/u,
    );
    assert.deepEqual(
      JSON.parse(readFileSync(sourceFile, "utf8")).source,
      first.materializationReceipt.source,
    );
    const other = await coordinator.prepareActivation(
      agent("source-other-agent"),
      activation("source-other"),
      { cwd: firstCwd },
    );
    assert.notEqual(other.memoryIndexPath, first.memoryIndexPath);
  } finally {
    await coordinator.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an unrelated invalid catalog does not block Agent memory or silently assign a project", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-catalog-fallback-"));
  const rootDirectory = join(directory, "memory");
  const coordinator = new AgentMemoryCoordinator({
    rootDirectory,
    wake: () => false,
  });
  try {
    const seed = await coordinator.prepareActivation(
      agent("catalog-agent"),
      activation("catalog-seed"),
      { cwd: directory },
    );
    const original = readFileSync(seed.memoryIndexPath, "utf8");
    const unrelated = join(directory, "archived-checkout");
    await writeFile(unrelated, "not a directory");
    const path = join(rootDirectory, ".project-bindings.json");
    const config = {
      schemaVersion: 1,
      projects: [
        { key: "current", label: "Current", roots: [directory] },
        { key: "other", label: "Other", roots: [unrelated] },
      ],
    };
    await writeFile(path, JSON.stringify(config), { mode: 0o600 });
    const run = await coordinator.prepareActivation(
      agent("catalog-agent"),
      activation("catalog-fallback"),
      { cwd: directory },
    );
    assert.equal(run.memoryIndexPath, seed.memoryIndexPath);
    assert.equal(readFileSync(run.memoryIndexPath, "utf8"), original);
    assert.equal(run.materializationReceipt.source?.resolution, "unavailable");
    const view = JSON.parse(run.env.RAH_AGENT_MEMORY_BOOTSTRAP_JSON!);
    assert.equal(view.projectResolution, "unavailable");
    assert.equal(view.project, undefined);
    assert.equal(view.text, "");
    await writeFile(
      path,
      JSON.stringify({ schemaVersion: 1, projects: [config.projects[0]] }),
    );
    const recovered = await coordinator.prepareActivation(
      agent("catalog-agent"),
      activation("catalog-fixed"),
      { cwd: directory },
    );
    assert.equal(
      recovered.materializationReceipt.source?.resolution,
      "matched",
    );
    assert.equal(recovered.memoryIndexPath, seed.memoryIndexPath);
    await assert.rejects(
      coordinator.prepareActivation(
        agent("catalog-agent"),
        activation("catalog-fallback"),
        { cwd: directory },
      ),
      /different memory index or identity/u,
    );
    await assert.rejects(
      coordinator.prepareActivation(
        agent("catalog-agent"),
        activation("missing-cwd"),
        { cwd: join(directory, "missing") },
      ),
      /ENOENT/u,
    );
  } finally {
    await coordinator.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("memory activation defaults to the original Raft index without generated fragments", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-bootstrap-"));
  const coordinator = new AgentMemoryCoordinator({
    rootDirectory: join(directory, "memory"),
    wake: () => false,
  });
  try {
    const first = await coordinator.prepareActivation(
      agent("bootstrap-agent"),
      activation("bootstrap-1"),
    );
    const source = `# Agent\n## Key Knowledge\n- source cwd: /Users/${"long/".repeat(400)}\n- [project] Durable decision → notes/decision.md\n`;
    await writeFile(first.memoryIndexPath, source);
    const next = await coordinator.prepareActivation(
      agent("bootstrap-agent"),
      activation("bootstrap-2"),
    );
    const encoded = next.env.RAH_AGENT_MEMORY_BOOTSTRAP_JSON;
    assert.ok(
      encoded,
      "Computer must supply a bootstrap view, not only a raw index path",
    );
    assert.ok(Buffer.byteLength(encoded) <= 4096);
    const view = JSON.parse(encoded);
    assert.equal(view.mode, "raft_original");
    assert.equal(view.status, "read_original");
    assert.equal(view.text, "");
    assert.doesNotMatch(encoded, /Users|long\/|bootstrap-2/u);
    assert.equal(readFileSync(first.memoryIndexPath, "utf8"), source);
    assert.equal(next.memoryIndexPath, first.memoryIndexPath);
    const isolated = await coordinator.prepareActivation(
      agent("other-agent"),
      activation("bootstrap-3"),
    );
    assert.doesNotMatch(
      isolated.env.RAH_AGENT_MEMORY_BOOTSTRAP_JSON ?? "",
      /Durable decision/u,
    );
  } finally {
    await coordinator.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("oversized legacy index yields an explicit retrieval notice instead of unbounded startup text", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-large-bootstrap-"));
  const coordinator = new AgentMemoryCoordinator({
    rootDirectory: join(directory, "memory"),
    wake: () => false,
  });
  try {
    const first = await coordinator.prepareActivation(
      agent("large-agent"),
      activation("large-1"),
    );
    const source = "x".repeat(1_048_577);
    await writeFile(first.memoryIndexPath, source);
    const next = await coordinator.prepareActivation(
      agent("large-agent"),
      activation("large-2"),
    );
    assert.ok(next.env.RAH_AGENT_MEMORY_BOOTSTRAP_JSON);
    const view = JSON.parse(next.env.RAH_AGENT_MEMORY_BOOTSTRAP_JSON);
    assert.equal(view.status, "read_original");
    assert.equal(view.mode, "raft_original");
    assert.equal(view.text, "");
    assert.equal(readFileSync(first.memoryIndexPath, "utf8"), source);
  } finally {
    await coordinator.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("memory coordinator injects a stable typed App Inbox hint on the next real Activation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-coordinator-"));
  const coordinator = new AgentMemoryCoordinator({
    rootDirectory: join(directory, "agent-memory"),
    wake: () => false,
  });
  try {
    const first = await coordinator.prepareActivation(
      agent("agent-a"),
      activation("hint-1"),
    );
    assert.equal(first.materializationReceipt.runAttemptId, "hint-1");
    assert.equal(first.env[RAH_AGENT_APP_INBOX_JSON_ENV], undefined);
    await writeFile(
      first.memoryIndexPath,
      `# Persistent Agent\n${"x".repeat(65_536)}`,
      "utf8",
    );

    const second = await coordinator.prepareActivation(
      agent("agent-a"),
      activation("hint-2"),
    );
    const encoded = second.env[RAH_AGENT_APP_INBOX_JSON_ENV];
    assert.ok(encoded);
    const hints = JSON.parse(encoded) as Array<Record<string, unknown>>;
    assert.equal(hints.length, 1);
    assert.equal(hints[0]?.appId, "system.cleaner");
    assert.equal(hints[0]?.notificationClass, "memory_size_hint");
    assert.equal(hints[0]?.retention, "transient");
    assert.equal("sender" in (hints[0] ?? {}), false);
    assert.equal("roomId" in (hints[0] ?? {}), false);
    assert.equal("seq" in (hints[0] ?? {}), false);

    const replay = await coordinator.prepareActivation(
      agent("agent-a"),
      activation("hint-2"),
    );
    const replayHints = JSON.parse(
      replay.env[RAH_AGENT_APP_INBOX_JSON_ENV] ?? "[]",
    ) as Array<Record<string, unknown>>;
    assert.equal(replayHints[0]?.itemId, hints[0]?.itemId);
    assert.equal(replayHints[0]?.createdAtMs, hints[0]?.createdAtMs);
  } finally {
    await coordinator.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("workspace reset requires an exclusive terminal fence and is recoverable", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-reset-"));
  const releases: string[] = [];
  const fenceOperationIds: string[] = [];
  const providerOperationIds: string[] = [];
  let allowFence = false;
  let clearCount = 0;
  const coordinator = new AgentMemoryCoordinator({
    acquireResetFence: async (participantId, operationId) => {
      fenceOperationIds.push(operationId);
      if (!allowFence) return null;
      return {
        release: async () => {
          releases.push(participantId);
        },
      };
    },
    quarantineProviderContinuity: async (_participantId, operationId) => {
      providerOperationIds.push(operationId);
      clearCount += 1;
      return { recordCount: 2, rollback: async () => undefined };
    },
    now: () => 123_456,
    rootDirectory: join(directory, "agent-memory"),
    wake: () => false,
  });
  try {
    const prepared = await coordinator.prepareActivation(
      agent("agent-reset"),
      activation("reset-before"),
    );
    await writeFile(
      prepared.memoryIndexPath,
      "# Secret\nDurable fact\n",
      "utf8",
    );

    await assert.rejects(
      coordinator.resetWorkspace("agent-reset"),
      /exclusive terminal fence/u,
    );
    assert.match(readFileSync(prepared.memoryIndexPath, "utf8"), /Durable/u);

    allowFence = true;
    const receipt = await coordinator.resetWorkspace(
      "agent-reset",
      "human-reset-1",
    );
    assert.equal(receipt.kind, "quarantined");
    assert.equal(receipt.ownerParticipantId, "agent-reset");
    assert.equal(receipt.resetAtMs, 123_456);
    assert.equal(receipt.providerContinuityRecords, 2);
    assert.equal(existsSync(prepared.workspacePath), false);
    assert.equal(existsSync(receipt.quarantinePath), true);
    assert.equal(clearCount, 1);
    assert.deepEqual(releases, ["agent-reset"]);
    assert.equal(fenceOperationIds.length, 2);
    assert.equal(providerOperationIds.length, 1);
    assert.equal(fenceOperationIds[1], receipt.operationId);
    assert.equal(providerOperationIds[0], receipt.operationId);

    const replay = await coordinator.resetWorkspace(
      "agent-reset",
      "human-reset-1",
    );
    assert.equal(replay.operationId, receipt.operationId);
    assert.equal(replay.deduplicated, true);
    assert.equal(clearCount, 1);

    const reseeded = await coordinator.prepareActivation(
      agent("agent-reset"),
      activation("reset-after"),
    );
    assert.match(
      readFileSync(reseeded.memoryIndexPath, "utf8"),
      /^# Persistent Agent$/mu,
    );
    assert.doesNotMatch(
      readFileSync(reseeded.memoryIndexPath, "utf8"),
      /Durable/u,
    );
    await writeFile(reseeded.memoryIndexPath, "# New memory\n", "utf8");
    await coordinator.resetWorkspace("agent-reset", "human-reset-1");
    assert.match(readFileSync(reseeded.memoryIndexPath, "utf8"), /New memory/u);
  } finally {
    await coordinator.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("workspace reset rolls the memory move back when Provider continuity quarantine fails", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-reset-rollback-"));
  const coordinator = new AgentMemoryCoordinator({
    acquireResetFence: async () => ({ release: async () => undefined }),
    quarantineProviderContinuity: async () => {
      throw new Error("provider session store unavailable");
    },
    rootDirectory: join(directory, "agent-memory"),
    wake: () => false,
  });
  try {
    const prepared = await coordinator.prepareActivation(
      agent("agent-rollback"),
      activation("rollback-before"),
    );
    await writeFile(
      prepared.memoryIndexPath,
      "# Memory\nMust survive\n",
      "utf8",
    );
    await assert.rejects(
      coordinator.resetWorkspace("agent-rollback"),
      /provider session store unavailable/u,
    );
    assert.equal(existsSync(prepared.workspacePath), true);
    assert.match(
      readFileSync(prepared.memoryIndexPath, "utf8"),
      /Must survive/u,
    );
  } finally {
    await coordinator.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("workspace reset keeps its global fence when rollback cannot prove a safe state", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-memory-reset-fail-closed-"),
  );
  const rootDirectory = join(directory, "agent-memory");
  let releaseCount = 0;
  const coordinator = new AgentMemoryCoordinator({
    acquireResetFence: async () => ({
      release: async () => {
        releaseCount += 1;
      },
    }),
    quarantineProviderContinuity: async () => {
      await writeFile(
        join(rootDirectory, ".reset-receipts"),
        "not a directory",
      );
      return {
        recordCount: 1,
        rollback: async () => {
          throw new Error("continuity rollback failed");
        },
      };
    },
    rootDirectory,
    wake: () => false,
  });
  try {
    await coordinator.prepareActivation(
      agent("agent-fail-closed"),
      activation("fail-closed-before"),
    );
    await assert.rejects(
      coordinator.resetWorkspace("agent-fail-closed"),
      (error: unknown) =>
        error instanceof AggregateError &&
        error.errors.some(
          (nested) =>
            nested instanceof Error &&
            /continuity rollback failed/u.test(nested.message),
        ),
    );
    assert.equal(releaseCount, 0);
  } finally {
    await coordinator.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("workspace reset uses and releases the durable Kernel global Agent fence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-kernel-fence-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "kernel.db") });
  kernel.initialize();
  const participant = kernel.provisionPrincipal({
    handle: "memory-fenced-agent",
    kind: "agent",
  }).principal;
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "memory-host",
      participantIds: [participant.principalId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  const control = createKernelAgentHostControlPort(kernel, host);
  const coordinator = new AgentMemoryCoordinator({
    acquireResetFence: createAgentMemoryResetFenceAcquirer(control),
    quarantineProviderContinuity: async () => ({
      recordCount: 0,
      rollback: async () => undefined,
    }),
    rootDirectory: join(directory, "agent-memory"),
    wake: () => false,
  });
  try {
    const receipt = await coordinator.resetWorkspace(participant.principalId);
    const lease = kernel.getAgentExclusiveOperationLease(receipt.operationId);
    assert.equal(lease.kind, "memory_reset");
    assert.equal(lease.participantId, participant.principalId);
    assert.equal(lease.ownerHostId, host.hostId);
    assert.equal(lease.ownerHostInstanceId, host.instanceId);
    assert.equal(lease.state, "released");
  } finally {
    await coordinator.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
