import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  prepareAgentMemoryRun,
  type ActivationEnvelope,
} from "@rah-os/agent-host";
import {
  MEMORY_INDEX_MAX_BYTES,
  type AgentRuntimeContext,
} from "@rah-os/protocol";

import {
  roleInstanceFixture,
  startInstanceRun,
} from "../../kernel/test/role-instance-fixture.ts";
import { startupMemorySystemLease } from "../src/startup-memory-system-lease.ts";
import { standingPromptLease } from "../src/standing-prompt-lease.ts";

/**
 * evo S6 batch B, contract §6 fixed overhead: a FREE offline measurement of
 * what a new Role instance session's first turn carries in its standing
 * prompt with 0/10/50/200 channel memory entries, against the same prompt
 * before batch B (Raft MEMORY.md prose, plus the seed MEMORY.md snapshot on
 * the Claude/Codex system transport). Real Kernel index read, real prompt
 * lease; no provider process, no model call. Tokens are an ESTIMATE (ASCII
 * characters / 4 + one token per non-ASCII character), never a measurement;
 * the paid efficiency gate stays the owner-authorized acceptance.
 *
 * `LOOM_S6_OVERHEAD_REPORT=1` prints the table (`npm run measure:s6-memory`).
 */

const COUNTS = [0, 10, 50, 200] as const;
/** Contract §6: first-generation input at most native + 3k tokens. */
const FIXED_OVERHEAD_BUDGET_TOKENS = 3_000;
/**
 * An assumed allowance (not measured here) for the first wake's own additions
 * over the native user message: the event line prefix and the `Reply:`
 * command line of a bodied wake.
 */
const FIRST_WAKE_ALLOWANCE_TOKENS = 200;

export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const character of text)
    if (character.charCodeAt(0) < 128) ascii += 1;
    else other += 1;
  return Math.ceil(ascii / 4) + other;
}

const description = (n: number, cjk: boolean) =>
  cjk
    ? `第${String(n)}条：发布分支周四切出，回归由测试组负责，冲突时以当前观察为准并更新本条。`
    : `Entry ${String(n)}: release branches are cut on Thursday and QA owns the regression run.`;

function agentContext(
  f: ReturnType<typeof roleInstanceFixture>,
): AgentRuntimeContext {
  return {
    schemaVersion: 1,
    participantId: f.instance.instanceId,
    handle: "reviewer",
    instanceChannelId: f.home.roomId,
    instanceSessionRequired: false,
    agentDefinitionRevision: {
      agentId: f.agentId,
      agentDefinitionRevisionId: f.revisionId,
      contentDigest: `sha256:${"1".repeat(64)}`,
      createdAt: "2026-09-27T00:00:00.000Z",
      createdBy: "human-owner",
      displayName: "Reviewer",
      executionPolicyRevisionId: "policy-1",
      instructions: "Review only.",
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "memory-policy",
        versionId: "memory-v1",
        contentDigest: `sha256:${"2".repeat(64)}`,
      },
      revision: 1,
      role: "Review",
      skillRefs: [],
    },
  } as AgentRuntimeContext;
}

function envelope(
  f: ReturnType<typeof roleInstanceFixture>,
  agent: AgentRuntimeContext,
): ActivationEnvelope {
  return {
    activationId: "activation-measure",
    consumerId: "consumer",
    hostId: f.host.hostId,
    participantId: f.instance.instanceId,
    roomId: f.home.roomId,
    reason: "manual",
    fromSeq: 1,
    toSeq: 1,
    runAttemptId: "run-measure",
    agent,
  } as ActivationEnvelope;
}

type Row = {
  entries: number;
  script: "ascii" | "cjk";
  indexBytes: number;
  indexLines: number;
  promptChars: number;
  promptTokens: number;
  overIndexZeroTokens: number;
  vsBeforeToolTokens: number;
  vsBeforeSystemTokens: number;
};

async function measure(): Promise<{
  beforeTool: number;
  beforeSystem: number;
  rows: Row[];
}> {
  const rows: Row[] = [];
  let beforeTool = 0;
  let beforeSystem = 0;
  for (const script of ["ascii", "cjk"] as const) {
    let zeroTokens = 0;
    for (const count of COUNTS) {
      const f = roleInstanceFixture();
      try {
        if (count > 0) {
          const work = startInstanceRun(f);
          for (let n = 0; n < count; n += 1)
            f.kernel.memory.write(work.execution, {
              name: `entry-${String(n).padStart(3, "0")}`,
              type: "project",
              description: description(n, script === "cjk"),
              body: `body ${String(n)}`,
              idempotencyKey: `measure-${String(n)}`,
            });
          work.finish(0);
        }
        const agent = agentContext(f);
        const scope = envelope(f, agent);
        const index = f.kernel.readInstanceMemoryIndex(f.host, {
          participantId: f.instance.instanceId,
        });
        const lease = standingPromptLease(scope, {
          channelMemory: { index, carryIndexSeq: true },
          machineHostname: "measure-host",
          machineOs: "darwin",
        })!;
        const prompt = lease.args![1]!;
        const section = lease.memoryIndex!.section;
        const tokens = estimateTokens(prompt);
        if (count === 0) zeroTokens = tokens;
        if (beforeTool === 0) {
          // Before batch B the same instance got the legacy prompt.
          const legacyAgent = { ...agent } as Record<string, unknown>;
          delete legacyAgent.instanceChannelId;
          delete legacyAgent.instanceSessionRequired;
          const legacy = standingPromptLease(
            envelope(f, legacyAgent as AgentRuntimeContext),
            { machineHostname: "measure-host", machineOs: "darwin" },
          )!;
          beforeTool = estimateTokens(legacy.args![1]!);
          const root = await mkdtemp(join(tmpdir(), "rah-s6-measure-"));
          try {
            const memory = await prepareAgentMemoryRun({
              activation: {
                activationId: "activation-measure",
                computerHostId: f.host.hostId,
                roomId: f.home.roomId,
                runAttemptId: "run-measure",
              },
              agent: legacyAgent as AgentRuntimeContext,
              rootDirectory: join(root, "agent-memory"),
            });
            const system = await startupMemorySystemLease({
              participantId: f.instance.instanceId,
              memoryDirectory: memory.env.RAH_AGENT_MEMORY_DIR!,
              promptLease: legacy,
            });
            try {
              beforeSystem = estimateTokens(
                await readFile(system.args![1]!, "utf8"),
              );
            } finally {
              await system.release?.();
            }
          } finally {
            await rm(root, { recursive: true, force: true });
          }
        }
        rows.push({
          entries: count,
          script,
          indexBytes: Buffer.byteLength(section, "utf8"),
          indexLines: section
            .split("\n")
            .filter((line) => line.startsWith("- ")).length,
          promptChars: prompt.length,
          promptTokens: tokens,
          overIndexZeroTokens: tokens - zeroTokens,
          vsBeforeToolTokens: tokens - beforeTool,
          vsBeforeSystemTokens: tokens - beforeSystem,
        });
      } finally {
        f.close();
      }
    }
  }
  return { beforeTool, beforeSystem, rows };
}

test("§6 offline measurement: the default index bound keeps the first-turn standing prompt within the fixed-overhead budget", async () => {
  const { beforeTool, beforeSystem, rows } = await measure();
  if (process.env.LOOM_S6_OVERHEAD_REPORT === "1")
    process.stdout.write(
      `${JSON.stringify({ indexMaxBytes: MEMORY_INDEX_MAX_BYTES, beforeBatchB: { toolModeTokens: beforeTool, systemTransportTokens: beforeSystem }, rows }, null, 2)}\n`,
    );
  for (const row of rows) {
    assert.ok(
      row.indexBytes <= MEMORY_INDEX_MAX_BYTES,
      `${String(row.entries)} ${row.script}: index ${String(row.indexBytes)} bytes`,
    );
    // The whole standing prompt (what Loom adds to the native CLI's own
    // system prompt on the first turn) stays under the §6 fixed overhead.
    assert.ok(
      row.promptTokens + FIRST_WAKE_ALLOWANCE_TOKENS <=
        FIXED_OVERHEAD_BUDGET_TOKENS,
      `${String(row.entries)} ${row.script}: prompt ~${String(row.promptTokens)} tokens`,
    );
  }
  // The largest channel is bounded: 200 entries cost no more than 50.
  const at = (entries: number, script: string) =>
    rows.find((row) => row.entries === entries && row.script === script)!;
  for (const script of ["ascii", "cjk"])
    assert.ok(
      at(200, script).promptChars <= at(50, script).promptChars + 64,
      "past the bound, more entries change only the omitted count and digits",
    );
  // Dropping the legacy MEMORY.md prose pays for the index up to 10 entries.
  assert.ok(at(10, "ascii").vsBeforeToolTokens < 0);
});
