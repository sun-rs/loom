import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AgentRuntimeContext } from "@rah-os/protocol";

import {
  AgentMemoryCleanerRuntime,
  AgentMemoryHintInbox,
  prepareAgentMemoryWorkspace,
  RAFT_MEMORY_CLEANER_APP_ID,
  RAFT_MEMORY_CLEANER_MAXIMUM_THRESHOLD_BYTES,
  RAFT_MEMORY_CLEANER_MINIMUM_INTERVAL_MS,
  RAFT_MEMORY_CLEANER_NOTIFICATION_CLASS,
} from "../src/index.ts";
import type { AgentMemoryCleanerClock } from "../src/index.ts";

function agent(participantId: string): AgentRuntimeContext {
  return {
    agentDefinitionRevision: {
      agentDefinitionId: `definition-${participantId}`,
      agentDefinitionRevisionId: `revision-${participantId}`,
      contentDigest: `sha256:${"1".repeat(64)}`,
      createdAt: "2026-08-30T09:00:00.000+08:00",
      createdBy: "human-owner",
      displayName: "Memory Cleaner Agent",
      executionPolicyRevisionId: "execution-full-access-v1",
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "memory-policy",
        contentDigest: `sha256:${"2".repeat(64)}`,
        versionId: "memory-policy-v1",
      },
      revision: 1,
      role: "Maintains private cross-Room memory",
      skillRefs: [],
    },
    handle: "memory-cleaner-agent",
    participantId,
    schemaVersion: 1,
  };
}

test("Raft-derived cleaner presents one typed transient App Inbox hint and never rewrites memory", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-cleaner-"));
  try {
    const workspace = await prepareAgentMemoryWorkspace({
      agent: agent("agent-cleaner-a"),
      rootDirectory: join(directory, "agent-memory"),
    });
    const oversized = `# Memory\n\n${"x".repeat(4_096)}\n`;
    await writeFile(workspace.memoryIndexPath, oversized, "utf8");
    const wakeItems: unknown[] = [];
    const inbox = new AgentMemoryHintInbox({ now: () => 123_456 });
    const cleaner = new AgentMemoryCleanerRuntime({
      inbox,
      wake: (_owner, item) => {
        wakeItems.push(item);
        return true;
      },
    });
    cleaner.applyConfig({
      enabled: true,
      intervalMs: RAFT_MEMORY_CLEANER_MINIMUM_INTERVAL_MS,
      memoryIndexPath: workspace.memoryIndexPath,
      ownerParticipantId: "agent-cleaner-a",
      revision: 1,
      thresholdBytes: 4_096,
    });

    const first = await cleaner.runNow("agent-cleaner-a");
    assert.equal(first.kind, "over_threshold");
    if (first.kind !== "over_threshold") return;
    assert.equal(first.hint.appId, RAFT_MEMORY_CLEANER_APP_ID);
    assert.equal(
      first.hint.notificationClass,
      RAFT_MEMORY_CLEANER_NOTIFICATION_CLASS,
    );
    assert.equal(first.hint.retention, "transient");
    assert.deepEqual(first.hint.sourceRef, {
      id: "agent-cleaner-a",
      kind: "memory_hint",
    });
    assert.equal(first.hint.suggestedThresholdBytes, 8_192);
    assert.match(
      first.hint.summary,
      /app config --app system\.cleaner --set threshold_bytes=8192/u,
    );
    assert.match(first.hint.title, /MEMORY\.md is 4\.0 KiB, over 4\.0 KiB/u);
    assert.match(
      first.hint.summary,
      /keep an index and move details to notes/u,
    );
    assert.equal("sender" in first.hint, false);
    assert.equal("msgId" in first.hint, false);
    assert.equal("seq" in first.hint, false);
    assert.equal(wakeItems.length, 1);
    const replay = await cleaner.runNow("agent-cleaner-a");
    assert.equal(replay.kind, "over_threshold");
    if (replay.kind !== "over_threshold") return;
    assert.equal(replay.hint.itemId, first.hint.itemId);
    assert.equal(replay.hint.createdAtMs, first.hint.createdAtMs);
    assert.equal(cleaner.listHints("agent-cleaner-a").length, 1);
    assert.equal(await readFile(workspace.memoryIndexPath, "utf8"), oversized);

    await writeFile(workspace.memoryIndexPath, "# Memory\n", "utf8");
    assert.deepEqual(await cleaner.runNow("agent-cleaner-a"), {
      kind: "under_threshold",
    });
    assert.deepEqual(cleaner.listHints("agent-cleaner-a"), []);
    await cleaner.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("cleaner scheduling is revision-fenced, bounded and re-armed before measurement", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-cleaner-clock-"));
  const scheduled: Array<{
    callback: () => void;
    cancelled: boolean;
    delayMs: number;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  const clock: AgentMemoryCleanerClock = {
    cancel: (timer) => {
      const entry = scheduled.find((candidate) => candidate.timer === timer);
      if (entry !== undefined) entry.cancelled = true;
    },
    now: () => 42,
    schedule: (callback, delayMs) => {
      const timer = Object.freeze({}) as ReturnType<typeof setTimeout>;
      scheduled.push({ callback, cancelled: false, delayMs, timer });
      return timer;
    },
  };
  try {
    const workspace = await prepareAgentMemoryWorkspace({
      agent: agent("agent-cleaner-clock"),
      rootDirectory: join(directory, "agent-memory"),
    });
    await writeFile(
      workspace.memoryIndexPath,
      `# Memory\n${"y".repeat(4_096)}`,
      "utf8",
    );
    let wakeCount = 0;
    const cleaner = new AgentMemoryCleanerRuntime({
      clock,
      wake: () => {
        wakeCount += 1;
        return true;
      },
    });
    assert.deepEqual(
      cleaner.applyConfig({
        enabled: true,
        intervalMs: RAFT_MEMORY_CLEANER_MINIMUM_INTERVAL_MS,
        memoryIndexPath: workspace.memoryIndexPath,
        ownerParticipantId: "agent-cleaner-clock",
        revision: 1,
        thresholdBytes: 4_096,
      }),
      { activeSchedules: 1, kind: "applied" },
    );
    assert.equal(
      scheduled[0]?.delayMs,
      RAFT_MEMORY_CLEANER_MINIMUM_INTERVAL_MS,
    );
    scheduled[0]?.callback();
    await cleaner.waitForIdle();
    assert.equal(wakeCount, 1);
    assert.equal(
      scheduled.filter(
        ({ delayMs }) => delayMs === RAFT_MEMORY_CLEANER_MINIMUM_INTERVAL_MS,
      ).length,
      2,
      "period must re-arm itself",
    );
    assert.equal(
      scheduled.find(({ delayMs }) => delayMs === 10_000)?.cancelled,
      true,
      "completed measurement cancels its deadline",
    );

    assert.deepEqual(
      cleaner.applyConfig({
        enabled: false,
        intervalMs: RAFT_MEMORY_CLEANER_MINIMUM_INTERVAL_MS,
        memoryIndexPath: workspace.memoryIndexPath,
        ownerParticipantId: "agent-cleaner-clock",
        revision: 2,
        thresholdBytes: 4_096,
      }),
      { activeSchedules: 0, kind: "applied" },
    );
    assert.equal(scheduled[1]?.cancelled, true);
    assert.deepEqual(cleaner.listHints("agent-cleaner-clock"), []);
    assert.deepEqual(await cleaner.runNow("agent-cleaner-clock"), {
      kind: "disabled",
    });
    assert.throws(
      () =>
        cleaner.applyConfig({
          enabled: true,
          intervalMs: RAFT_MEMORY_CLEANER_MINIMUM_INTERVAL_MS,
          memoryIndexPath: workspace.memoryIndexPath,
          ownerParticipantId: "agent-cleaner-clock",
          revision: 2,
          thresholdBytes: 4_096,
        }),
      /revision conflicts/u,
    );
    assert.throws(
      () =>
        cleaner.applyConfig({
          enabled: true,
          intervalMs: RAFT_MEMORY_CLEANER_MINIMUM_INTERVAL_MS - 1,
          memoryIndexPath: workspace.memoryIndexPath,
          ownerParticipantId: "agent-cleaner-clock",
          revision: 3,
          thresholdBytes: 4_096,
        }),
      /outside Raft bounds/u,
    );
    assert.throws(
      () =>
        cleaner.applyConfig({
          enabled: true,
          intervalMs: RAFT_MEMORY_CLEANER_MINIMUM_INTERVAL_MS,
          memoryIndexPath: workspace.memoryIndexPath,
          ownerParticipantId: "agent-cleaner-clock",
          revision: 3,
          thresholdBytes: RAFT_MEMORY_CLEANER_MAXIMUM_THRESHOLD_BYTES + 1,
        }),
      /outside Raft bounds/u,
    );
    await cleaner.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a failed maintenance wake cannot fail normal Agent activation preparation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-wake-failure-"));
  const cleaner = new AgentMemoryCleanerRuntime({
    wake: async () => {
      throw new Error("Computer maintenance unavailable");
    },
  });
  try {
    const workspace = await prepareAgentMemoryWorkspace({
      agent: agent("wake-agent"),
      rootDirectory: directory,
    });
    await writeFile(workspace.memoryIndexPath, "x".repeat(5_000));
    cleaner.applyConfig({
      enabled: true,
      intervalMs: RAFT_MEMORY_CLEANER_MINIMUM_INTERVAL_MS,
      memoryIndexPath: workspace.memoryIndexPath,
      ownerParticipantId: "wake-agent",
      revision: 1,
      thresholdBytes: 4_096,
    });
    assert.equal((await cleaner.runNow("wake-agent")).kind, "over_threshold");
    assert.equal(
      cleaner.listHints("wake-agent").length,
      1,
      "unavailable wake must retain the hint",
    );
  } finally {
    await cleaner.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("concurrent checks coalesce one pending wake and close fences late callbacks", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-wake-coalesce-"));
  let resolveWake!: (value: boolean) => void;
  const wakeResult = new Promise<boolean>((resolve) => {
    resolveWake = resolve;
  });
  let wakeCount = 0;
  const cleaner = new AgentMemoryCleanerRuntime({
    wake: () => {
      wakeCount += 1;
      return wakeResult;
    },
  });
  try {
    const workspace = await prepareAgentMemoryWorkspace({
      agent: agent("wake-agent"),
      rootDirectory: directory,
    });
    await writeFile(workspace.memoryIndexPath, "x".repeat(5_000));
    cleaner.applyConfig({
      enabled: true,
      intervalMs: RAFT_MEMORY_CLEANER_MINIMUM_INTERVAL_MS,
      memoryIndexPath: workspace.memoryIndexPath,
      ownerParticipantId: "wake-agent",
      revision: 1,
      thresholdBytes: 4_096,
    });
    const checks = [cleaner.runNow("wake-agent"), cleaner.runNow("wake-agent")];
    await Promise.all(checks);
    assert.equal(
      wakeCount,
      1,
      "periodic and activation checks must not dispatch parallel maintenance",
    );
    resolveWake(true);
    const lateCheck = cleaner.runNow("wake-agent");
    await cleaner.close();
    await lateCheck;
    assert.equal(
      wakeCount,
      1,
      "close must invalidate in-flight inspection before wake",
    );
    assert.deepEqual(cleaner.listHints("wake-agent"), []);
  } finally {
    resolveWake(false);
    await cleaner.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Raft measurement timeout bounds a stalled filesystem and ignores late results", async () => {
  const pendingTimers: Array<{
    callback: () => void;
    delayMs: number;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  let finishMeasurement!: (result: {
    kind: "within_threshold";
    bytes: number;
    thresholdBytes: number;
  }) => void;
  let wakeCount = 0;
  const cleaner = new AgentMemoryCleanerRuntime({
    clock: {
      now: () => 0,
      cancel: () => {},
      schedule: (callback, delayMs) => {
        const timer = {} as ReturnType<typeof setTimeout>;
        pendingTimers.push({ callback, delayMs, timer });
        return timer;
      },
    },
    inspectIndex: () =>
      new Promise((resolve) => {
        finishMeasurement = resolve;
      }),
    wake: () => {
      wakeCount += 1;
      return true;
    },
  });
  cleaner.applyConfig({
    enabled: true,
    intervalMs: RAFT_MEMORY_CLEANER_MINIMUM_INTERVAL_MS,
    memoryIndexPath: "/isolated-fixture/MEMORY.md",
    ownerParticipantId: "stalled-agent",
    revision: 1,
    thresholdBytes: 4_096,
  });
  const inspection = cleaner.runNow("stalled-agent");
  await Promise.resolve();
  const timeout = pendingTimers.find(({ delayMs }) => delayMs === 10_000);
  assert.ok(timeout, "Raft bounds memory measurement at ten seconds");
  timeout.callback();
  assert.deepEqual(await inspection, { kind: "not_established" });
  await cleaner.close();
  finishMeasurement({
    kind: "within_threshold",
    bytes: 0,
    thresholdBytes: 4_096,
  });
  await Promise.resolve();
  assert.equal(wakeCount, 0);
});
