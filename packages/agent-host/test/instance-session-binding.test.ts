import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AgentRuntimeContext } from "@rah-os/protocol";

import { GenericProcessAdapter } from "../src/generic-process-adapter.ts";
import type { ActivationEnvelope } from "../src/runtime.ts";

// S1-f: the Kernel learns that an instance's native session is bound only after
// the Host persisted the binding, never from a spawned process alone.
const agent = (instance: boolean): AgentRuntimeContext => ({
  agentDefinitionRevision: {
    agentId: "agent-definition-binding",
    agentDefinitionRevisionId: "agent-definition-revision-binding",
    contentDigest: `sha256:${"a".repeat(64)}`,
    createdAt: "2026-09-24T00:00:00.000Z",
    createdBy: "principal-owner",
    executionPolicyRevisionId: "execution-policy-binding",
    instructionRefs: [],
    memoryPolicyRef: {
      artifactId: "memory-policy",
      contentDigest: `sha256:${"b".repeat(64)}`,
      versionId: "room-memory-v1",
    },
    revision: 1,
    role: "Reviewer",
    skillRefs: [],
  },
  ...(instance ? { instanceChannelId: "channel-binding" } : {}),
  participantId: "participant-binding",
  schemaVersion: 1,
});

const envelope = (instance: boolean): ActivationEnvelope => ({
  activationId: "activation-binding",
  agent: agent(instance),
  consumerId: "binding:runtime",
  fromSeq: 1,
  hostId: "binding-host",
  participantId: "participant-binding",
  reason: "mention",
  roomId: "room-binding",
  runAttemptId: "run-binding",
  toSeq: 2,
});

const SESSION_FRAME = `require('node:fs').writeSync(3, JSON.stringify({protocol:'rah-provider-session/v1', provider:'fixture-provider/v1', providerSessionId:'native-1', state:'ready'})+'\\n');`;

async function runWith(input: {
  instance: boolean;
  exitAfterFrame: boolean;
  recordEvidence: () => Promise<void>;
  recordBinding: (value: {
    runAttemptId: string;
    runtimeRunId: string;
  }) => Promise<void>;
}) {
  const directory = mkdtempSync(join(tmpdir(), "rah-instance-binding-"));
  const adapter = new GenericProcessAdapter({
    command: process.execPath,
    args: [
      "-e",
      input.exitAfterFrame
        ? SESSION_FRAME
        : `${SESSION_FRAME} setInterval(()=>{},1000);`,
    ],
    cwd: directory,
    terminationGraceMs: 20,
    recordProviderSessionEvidence: input.recordEvidence,
  });
  const run = await adapter.start(envelope(input.instance), {
    registerPrepared: async () => undefined,
    recordInstanceSessionBinding: input.recordBinding,
  });
  try {
    const exit = await Promise.race([
      adapter.reap(run),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("runtime did not stop")),
          1500,
        );
        timer.unref();
      }),
    ]);
    return { exit, runId: run.runId };
  } finally {
    await adapter.cancel(run);
    rmSync(directory, { recursive: true, force: true });
  }
}

test("an instance reports its session binding to the Kernel after the Host persisted it", async () => {
  const order: string[] = [];
  const reported: Array<{ runAttemptId: string; runtimeRunId: string }> = [];
  const { exit, runId } = await runWith({
    instance: true,
    exitAfterFrame: true,
    recordEvidence: async () => {
      order.push("host-file");
    },
    recordBinding: async (value) => {
      order.push("kernel");
      reported.push(value);
    },
  });
  assert.equal(exit.code, 0);
  assert.deepEqual(order, ["host-file", "kernel"]);
  assert.deepEqual(reported, [
    { runAttemptId: "run-binding", runtimeRunId: runId },
  ]);
});

test("a legacy Agent session never claims instance binding evidence", async () => {
  let reported = 0;
  const { exit } = await runWith({
    instance: false,
    exitAfterFrame: true,
    recordEvidence: async () => undefined,
    recordBinding: async () => {
      reported += 1;
    },
  });
  assert.equal(exit.code, 0);
  assert.equal(reported, 0);
});

test("a failed Host binding file never produces Kernel binding evidence", async () => {
  let reported = 0;
  const { exit } = await runWith({
    instance: true,
    exitAfterFrame: false,
    recordEvidence: async () => {
      throw new Error("disk write rejected");
    },
    recordBinding: async () => {
      reported += 1;
    },
  });
  assert.match(exit.failure!.message, /RAH_SESSION_CONTINUITY_REQUIRED/);
  assert.equal(reported, 0);
});

test("unrecorded Kernel binding evidence stops the instance runtime (fail closed)", async () => {
  const { exit } = await runWith({
    instance: true,
    exitAfterFrame: false,
    recordEvidence: async () => undefined,
    recordBinding: async () => {
      throw new Error("kernel unavailable");
    },
  });
  assert.equal(exit.failure?.retryDisposition, "sticky_terminal");
  assert.match(exit.failure!.message, /RAH_SESSION_CONTINUITY_REQUIRED/);
});
