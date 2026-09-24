import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AgentRuntimeContext } from "@rah-os/protocol";

import {
  AgentHost,
  GenericProcessAdapter,
  type AgentHostControlPort,
  type RuntimeAdapter,
} from "../src/index.ts";
import type { ActivationEnvelope } from "../src/runtime.ts";

// Review P1-2: a Role instance may only run on a Host that can report durable
// session binding evidence to the Kernel. Without it, a lost Host binding file
// could silently start a replacement session. Legacy Agents keep running.
const agent = (instance: boolean): AgentRuntimeContext => ({
  agentDefinitionRevision: {
    agentId: "agent-definition-capability",
    agentDefinitionRevisionId: "agent-definition-revision-capability",
    contentDigest: `sha256:${"a".repeat(64)}`,
    createdAt: "2026-09-24T00:00:00.000Z",
    createdBy: "principal-owner",
    executionPolicyRevisionId: "execution-policy-capability",
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
  ...(instance
    ? {
        instanceChannelId: "channel-capability",
        instanceSessionGeneration: 0,
        instanceSessionRequired: false,
      }
    : {}),
  handle: "reviewer",
  participantId: "participant-capability",
  schemaVersion: 1,
});

const envelope = (instance: boolean): ActivationEnvelope => ({
  activationId: "activation-capability",
  agent: agent(instance),
  consumerId: "capability:runtime",
  fromSeq: 1,
  hostId: "capability-host",
  participantId: "participant-capability",
  reason: "mention",
  roomId: "room-capability",
  runAttemptId: "run-capability",
  toSeq: 2,
});

test("an instance launch without a binding-evidence callback is refused before spawn", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-instance-capability-"));
  try {
    const adapter = new GenericProcessAdapter({
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
      cwd: directory,
      recordProviderSessionEvidence: async () => undefined,
    });
    let prepared = 0;
    await assert.rejects(
      adapter.start(envelope(true), {
        registerPrepared: async () => {
          prepared += 1;
        },
      }),
      /RAH_INSTANCE_HOST_UNSUPPORTED/,
    );
    assert.equal(prepared, 0, "no process was prepared for the instance");
    // A legacy Agent on the same Host is unaffected.
    const run = await adapter.start(envelope(false), {
      registerPrepared: async () => undefined,
    });
    assert.equal((await adapter.reap(run)).code, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fakeControl(instance: boolean) {
  const calls: Array<{ method: string; input: unknown }> = [];
  const known: Record<string, unknown> = {
    claimNextPlacement: async () =>
      ({
        activation: {
          activationId: "activation-capability",
          attemptCount: 1,
        },
        agentContext: agent(instance),
        placement: { placementId: "placement-capability" },
        runAttempt: { runAttemptId: "run-capability" },
      }) as never,
    // A Host control that cannot report binding evidence (e.g. remote today).
    recordInstanceSessionBinding: undefined,
  };
  const control = new Proxy(known, {
    get(target, property: string) {
      if (property in target) return target[property];
      return async (input: unknown) => {
        calls.push({ method: property, input });
        return undefined;
      };
    },
  }) as unknown as AgentHostControlPort;
  return { calls, control };
}

function host(instance: boolean) {
  const { calls, control } = fakeControl(instance);
  let started = 0;
  const runtime: RuntimeAdapter = {
    async cancel() {
      return { code: null, signal: "SIGTERM" };
    },
    async probe() {
      return { available: true };
    },
    async reap() {
      return { code: 0 };
    },
    async start() {
      started += 1;
      throw new Error("fixture runtime stops here");
    },
  };
  const agentHost = new AgentHost({
    control,
    host: {
      hostId: "capability-host",
      instanceId: "capability-host-instance",
      participantIds: ["participant-capability"],
    },
    leaseMs: 30_000,
    placementRuntimeResolver: () => runtime,
    runtime,
  });
  return { agentHost, calls, started: () => started };
}

test("AgentHost refuses a Role instance on a Host without binding evidence, visibly and without retry churn", async () => {
  const { agentHost, calls, started } = host(true);
  const result = await agentHost.reconcileOnce();
  assert.equal(result.state, "failed");
  assert.equal(started(), 0, "the runtime was never started");
  const finish = calls.find((call) => call.method === "finishRunAttempt");
  assert.deepEqual(
    {
      runAttemptId: (finish?.input as { runAttemptId: string }).runAttemptId,
      state: (finish?.input as { state: string }).state,
    },
    { runAttemptId: "run-capability", state: "failed" },
  );
  assert.match(
    (finish?.input as { error: string }).error,
    /RAH_INSTANCE_HOST_UNSUPPORTED/,
  );
  const retry = calls.find((call) => call.method === "retryActivation")
    ?.input as { error: string; retryDisposition?: string };
  assert.match(retry.error, /RAH_INSTANCE_HOST_UNSUPPORTED/);
  assert.equal(retry.retryDisposition, "sticky_terminal");
});

test("a legacy Agent still launches on a Host without instance binding evidence", async () => {
  const { agentHost, calls, started } = host(false);
  await agentHost.reconcileOnce();
  assert.equal(started(), 1);
  assert.ok(
    calls.every(
      (call) => !JSON.stringify(call.input).includes("INSTANCE_HOST"),
    ),
  );
});
