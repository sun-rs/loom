import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  GenericProcessAdapter,
  type ActivationEnvelope,
} from "../src/index.ts";

const fakeCliPath = fileURLToPath(
  new URL("./fixtures/fake-cli.mjs", import.meta.url),
);
const disposableHostPath = fileURLToPath(
  new URL("./fixtures/disposable-process-host.mjs", import.meta.url),
);

function activationEnvelope(): ActivationEnvelope {
  return {
    activationId: "activation-process-test",
    consumerId: "process-test:runtime",
    fromSeq: 4,
    hostId: "process-test",
    participantId: "agent-process-test",
    reason: "mention",
    roomId: "room-process-test",
    runAttemptId: "run-process-test",
    toSeq: 8,
  };
}

async function startProcess(
  adapter: GenericProcessAdapter,
  input: ActivationEnvelope = activationEnvelope(),
): Promise<Awaited<ReturnType<GenericProcessAdapter["start"]>>> {
  let preparedRunId: string | undefined;
  const run = await adapter.start(input, {
    registerPrepared: async (prepared) => {
      preparedRunId = prepared.runId;
    },
  });
  assert.equal(preparedRunId, run.runId);
  return run;
}

async function waitForDiagnostic(
  adapter: GenericProcessAdapter,
  run: { runId: string },
  marker = "fake-cli diagnostic",
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!adapter.diagnostics(run).stderr.includes(marker)) {
    if (Date.now() >= deadline) {
      throw new Error("Fake CLI did not become ready");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function launchFromDisposableHost(input: {
  directory: string;
  pidFile: string;
}): Promise<Awaited<ReturnType<GenericProcessAdapter["start"]>>> {
  const child = spawn(process.execPath, [disposableHostPath], {
    env: {
      ...process.env,
      RAH_TEST_FAKE_CLI_PATH: fakeCliPath,
      RAH_TEST_PID_FILE: input.pidFile,
      RAH_TEST_SUPERVISOR_DIRECTORY: input.directory,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  let stdout = "";
  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(exitCode, 0, stderr);
  return JSON.parse(stdout.trim()) as Awaited<
    ReturnType<GenericProcessAdapter["start"]>
  >;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

for (const supervised of [false, true])
  test(`runtime liveness probes the owned child (${supervised ? "supervised" : "direct"})`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "rah-runtime-liveness-"));
    const adapter = new GenericProcessAdapter({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: directory,
      ...(supervised
        ? { supervisorDirectory: join(directory, "supervisors") }
        : {}),
    });
    const run = await startProcess(adapter);
    try {
      assert.equal(await adapter.isAlive(run), true);
    } finally {
      await adapter.cancel(run);
    }
    assert.equal(await adapter.isAlive(run), false);
    rmSync(directory, { recursive: true, force: true });
  });

test("GenericProcessAdapter launches a Fake CLI and keeps output diagnostic-only", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-process-adapter-"));
  try {
    const adapter = new GenericProcessAdapter({
      args: [fakeCliPath],
      command: process.execPath,
      cwd: directory,
      env: {
        RAH_ACTIVATION_ID: "must-not-override-the-envelope",
        RAH_FAKE_MODE: "success",
      },
    });
    assert.equal((await adapter.probe()).available, true);

    const run = await startProcess(adapter);
    const exit = await adapter.reap(run);
    const diagnostics = adapter.diagnostics(run);

    assert.equal(exit.code, 0);
    assert.match(diagnostics.stdout, /opaque-fake-cli-output/);
    assert.equal(
      JSON.parse(diagnostics.stdout).activationId,
      "activation-process-test",
    );
    assert.equal(JSON.parse(diagnostics.stdout).hasSupervisorConfig, false);
    assert.equal(JSON.parse(diagnostics.stdout).hasSupervisorToken, false);
    assert.match(diagnostics.stderr, /fake-cli diagnostic/);
    assert.equal(diagnostics.truncated, false);
    assert.equal("businessResult" in diagnostics, false);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter transports typed driver trajectory separately from diagnostics", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-process-trajectory-"));
  try {
    const adapter = new GenericProcessAdapter({
      args: [fakeCliPath],
      command: process.execPath,
      cwd: directory,
      env: { RAH_FAKE_MODE: "trajectory" },
    });
    const activities: unknown[] = [];
    const run = await adapter.start(activationEnvelope(), {
      recordTrajectory: async (activity) => {
        activities.push(activity);
      },
      registerPrepared: async () => undefined,
    });
    assert.equal((await adapter.reap(run)).code, 0);
    assert.deepEqual(
      activities.map((activity) =>
        typeof activity === "object" && activity !== null
          ? (activity as { entry: { kind: string } }).entry.kind
          : undefined,
      ),
      ["status", "tool_start"],
    );
    assert.ok(
      activities.every(
        (activity) =>
          typeof activity === "object" &&
          activity !== null &&
          (activity as { runAttemptId?: string }).runAttemptId ===
            "run-process-test" &&
          (activity as { runtimeRunId?: string }).runtimeRunId === run.runId,
      ),
    );
    assert.doesNotMatch(adapter.diagnostics(run).stdout, /tool_start/u);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter redacts lease secrets inside recorded trajectory entries", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-os-process-trajectory-redaction-"),
  );
  try {
    const secret = "super-secret-token-123";
    const adapter = new GenericProcessAdapter({
      activationEnvironment: () => ({
        env: {
          RAH_FAKE_MODE: "trajectory",
          RAH_FAKE_TRAJECTORY_SECRET: secret,
        },
        redactions: [secret],
      }),
      args: [fakeCliPath],
      command: process.execPath,
      cwd: directory,
    });
    const activities: unknown[] = [];
    const run = await adapter.start(activationEnvelope(), {
      recordTrajectory: async (activity) => {
        activities.push(activity);
      },
      registerPrepared: async () => undefined,
    });
    assert.equal((await adapter.reap(run)).code, 0);

    const entries = activities.map(
      (activity) =>
        (activity as { entry: Record<string, unknown> }).entry as Record<
          string,
          unknown
        >,
    );
    assert.deepEqual(
      entries.map((entry) => entry.kind),
      ["status", "tool_start", "tool_start", "text"],
    );
    const toolInput = entries[2]?.toolInput;
    const text = entries[3]?.text;
    assert.equal(typeof toolInput, "string");
    assert.equal(typeof text, "string");
    assert.ok((toolInput as string).includes("[REDACTED]"));
    assert.ok((text as string).includes("[REDACTED]"));
    assert.equal(
      JSON.stringify(activities).includes(secret),
      false,
      "recorded trajectory must never carry the lease secret",
    );

    const diagnostics = adapter.diagnostics(run);
    assert.equal(diagnostics.stdout.includes(secret), false);
    assert.equal(diagnostics.stderr.includes(secret), false);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter carries a structured Runtime failure from trajectory into the terminal exit", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-os-process-runtime-error-"),
  );
  try {
    const adapter = new GenericProcessAdapter({
      args: [
        "-e",
        [
          "const frame={observedAt:new Date().toISOString(),producerSequence:1,entry:{kind:'status',activity:'error',detailKind:'runtime_error',detail:'Authentication failed: please log in first'}};",
          "process.stdout.write('opaque output\\n');",
          "process.stderr.write('provider diagnostic\\n');",
          "require('fs').writeSync(3, JSON.stringify(frame)+'\\n');",
          "process.exit(1);",
        ].join(""),
      ],
      command: process.execPath,
      cwd: directory,
    });
    const run = await adapter.start(activationEnvelope(), {
      recordTrajectory: async () => undefined,
      registerPrepared: async () => undefined,
    });
    const exit = await adapter.reap(run);
    assert.equal(exit.code, 1);
    assert.equal(exit.failure?.errorClass, "AuthError");
    assert.equal(exit.failure?.retryDisposition, "action_required");
    assert.equal(exit.failure?.actionRequired, true);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter keeps Provider session evidence out of canonical trajectory", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-os-provider-session-frame-"),
  );
  try {
    const evidence: unknown[] = [];
    const trajectory: unknown[] = [];
    const adapter = new GenericProcessAdapter({
      args: [fakeCliPath],
      command: process.execPath,
      cwd: directory,
      env: { RAH_FAKE_MODE: "provider-session" },
      recordProviderSessionEvidence: async (activation, frame) => {
        evidence.push({ activationId: activation.activationId, frame });
      },
    });
    const run = await adapter.start(activationEnvelope(), {
      recordTrajectory: async (activity) => {
        trajectory.push(activity);
      },
      registerPrepared: async () => undefined,
    });
    assert.equal((await adapter.reap(run)).code, 0);
    assert.deepEqual(trajectory, []);
    assert.deepEqual(evidence, [
      {
        activationId: "activation-process-test",
        frame: {
          protocol: "rah-provider-session/v1",
          provider: "fixture-provider/v1",
          providerSessionId: "fixture-provider-session-private",
          state: "ready",
        },
      },
    ]);
    assert.doesNotMatch(
      JSON.stringify(adapter.diagnostics(run)),
      /fixture-provider-session-private/u,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

// evo §40: a CLI-reported cost frame reaches its owner; an invalid one is
// dropped with a diagnostic (never guessed) and never becomes trajectory.
test("GenericProcessAdapter routes CLI cost frames to the cost owner", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-provider-cost-frame-"));
  try {
    const cost = {
      protocol: "rah-provider-cost/v1",
      provider: "claude-stream-json/v1",
      costId: "result-1",
      source: "claude_result_total_cost_usd",
      reportedTotalUsd: 0.4,
      costUsd: 0.1,
      observedAt: "2026-09-26T01:00:00.000Z",
    };
    const frames = [cost, { ...cost, costId: "bad", costUsd: -1 }];
    const recorded: unknown[] = [];
    const trajectory: unknown[] = [];
    const adapter = new GenericProcessAdapter({
      args: [
        "-e",
        `for (const frame of ${JSON.stringify(frames)}) require('node:fs').writeSync(3, JSON.stringify(frame)+'\\n');`,
      ],
      command: process.execPath,
      cwd: directory,
    });
    const run = await adapter.start(activationEnvelope(), {
      recordTrajectory: async (activity) => {
        trajectory.push(activity.entry);
      },
      recordCost: async (input) => {
        recorded.push(input);
      },
      registerPrepared: async () => undefined,
    });
    assert.equal((await adapter.reap(run)).code, 0);
    const { protocol: _protocol, ...fields } = cost;
    assert.deepEqual(recorded, [
      { ...fields, runAttemptId: "run-process-test", runtimeRunId: run.runId },
    ]);
    assert.deepEqual(trajectory, []);
    assert.match(
      adapter.diagnostics(run).stderr,
      /ignored invalid CLI cost frame/u,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter routes Provider usage frames to the usage owner, never to trajectory", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-provider-usage-frame-"));
  try {
    const usage = {
      protocol: "rah-provider-usage/v1",
      provider: "fixture-provider/v1",
      responseId: "response-1",
      inputTokens: 1000,
      cachedInputTokens: 900,
      outputTokens: 40,
      reasoningOutputTokens: null,
      contextWindow: null,
      contextUsedTokens: null,
      observedAt: "2026-09-24T01:00:00.000Z",
    };
    const frames = [
      usage,
      { ...usage, responseId: "response-bad", cachedInputTokens: 1001 },
      {
        protocol: "rah-provider-usage-gap/v1",
        provider: "fixture-provider/v1",
        reason: "inconsistent_total",
        observedAt: "2026-09-24T01:00:00.500Z",
      },
      {
        entry: { kind: "status", activity: "working", detailKind: "starting" },
        observedAt: "2026-09-24T01:00:01.000Z",
        producerSequence: 1,
      },
    ];
    const recorded: unknown[] = [];
    const gaps: unknown[] = [];
    const trajectory: unknown[] = [];
    const adapter = new GenericProcessAdapter({
      args: [
        "-e",
        `for (const frame of ${JSON.stringify(frames)}) require('node:fs').writeSync(3, JSON.stringify(frame)+'\\n');`,
      ],
      command: process.execPath,
      cwd: directory,
    });
    const run = await adapter.start(activationEnvelope(), {
      recordTrajectory: async (activity) => {
        trajectory.push(activity.entry);
      },
      recordUsage: async (input) => {
        recorded.push(input);
      },
      recordUsageGap: async (input) => {
        gaps.push(input);
      },
      registerPrepared: async () => undefined,
    });
    assert.equal((await adapter.reap(run)).code, 0);
    const { protocol: _protocol, ...fields } = usage;
    assert.deepEqual(recorded, [
      { ...fields, runAttemptId: "run-process-test", runtimeRunId: run.runId },
    ]);
    // An invalid usage frame is a parse gap (never a generation); a driver gap
    // is forwarded as is. Both only mark the RunAttempt's usage incomplete.
    const scope = { runAttemptId: "run-process-test", runtimeRunId: run.runId };
    assert.deepEqual(gaps, [
      {
        provider: "fixture-provider/v1",
        reason: "parse_error",
        observedAt: "2026-09-24T01:00:00.000Z",
        ...scope,
      },
      {
        provider: "fixture-provider/v1",
        reason: "inconsistent_total",
        observedAt: "2026-09-24T01:00:00.500Z",
        ...scope,
      },
    ]);
    assert.deepEqual(trajectory, [
      { kind: "status", activity: "working", detailKind: "starting" },
    ]);
    assert.match(
      adapter.diagnostics(run).stderr,
      /ignored invalid Provider usage frame/u,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter binds aggregate diagnostics to its run without inventing generations", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-usage-aggregate-"));
  try {
    const aggregate = {
      protocol: "rah-provider-usage-aggregate/v1",
      provider: "fixture-provider/v1",
      kind: "compaction",
      nativeSessionId: "native-session-1",
      entryId: "compact-entry-1",
      inputTokens: 1000,
      cachedInputTokens: 900,
      outputTokens: 40,
      reasoningOutputTokens: null,
      observedAt: "2026-09-24T01:00:00.000Z",
    };
    const frames = [
      { ...aggregate, entryId: "bad-entry", cachedInputTokens: 1001 },
      aggregate,
    ];
    const recorded: unknown[] = [];
    const generations: unknown[] = [];
    const gaps: unknown[] = [];
    const trajectory: unknown[] = [];
    const adapter = new GenericProcessAdapter({
      args: [
        "-e",
        `require('node:fs').writeSync(3, ${JSON.stringify(frames.map((frame) => JSON.stringify(frame)).join("\n"))});`,
      ],
      command: process.execPath,
      cwd: directory,
    });
    const run = await adapter.start(activationEnvelope(), {
      recordUsageAggregate: async (input) => {
        recorded.push(input);
      },
      recordUsage: async (input) => {
        generations.push(input);
      },
      recordUsageGap: async (input) => {
        gaps.push(input);
      },
      recordTrajectory: async (input) => {
        trajectory.push(input);
      },
      registerPrepared: async () => undefined,
    });
    assert.equal((await adapter.reap(run)).code, 0);
    const { protocol: _protocol, ...fields } = aggregate;
    const scope = { runAttemptId: "run-process-test", runtimeRunId: run.runId };
    assert.deepEqual(recorded, [{ ...fields, ...scope }]);
    assert.deepEqual(gaps, [
      {
        provider: aggregate.provider,
        reason: "parse_error",
        observedAt: aggregate.observedAt,
        ...scope,
      },
    ]);
    assert.deepEqual(generations, []);
    assert.deepEqual(trajectory, []);
    // An aggregate-only consumer must also receive the final unterminated frame.
    const aggregateOnly: unknown[] = [];
    const secondRun = await adapter.start(activationEnvelope(), {
      recordUsageAggregate: async (input) => {
        aggregateOnly.push(input);
      },
      registerPrepared: async () => undefined,
    });
    assert.equal((await adapter.reap(secondRun)).code, 0);
    assert.deepEqual(aggregateOnly, [
      {
        ...fields,
        runAttemptId: "run-process-test",
        runtimeRunId: secondRun.runId,
      },
    ]);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter preserves a coverage gap when aggregate attribution is rejected", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-aggregate-rejected-"));
  try {
    const aggregate = {
      protocol: "rah-provider-usage-aggregate/v1",
      provider: "fixture-provider/v1",
      kind: "compaction",
      nativeSessionId: "native-session-1",
      entryId: "already-attributed-entry",
      inputTokens: 1000,
      outputTokens: 40,
      cachedInputTokens: null,
      reasoningOutputTokens: null,
      observedAt: "2026-09-24T01:00:00.000Z",
    };
    const generation = {
      protocol: "rah-provider-usage/v1",
      provider: aggregate.provider,
      responseId: "response-after-rejection",
      inputTokens: 500,
      cachedInputTokens: 400,
      outputTokens: 20,
      reasoningOutputTokens: null,
      contextWindow: null,
      contextUsedTokens: null,
      observedAt: aggregate.observedAt,
    };
    const generations: unknown[] = [];
    const gaps: unknown[] = [];
    let attempts = 0;
    const adapter = new GenericProcessAdapter({
      args: [
        "-e",
        `for (const frame of ${JSON.stringify([aggregate, generation])}) require('node:fs').writeSync(3, JSON.stringify(frame)+'\\n');`,
      ],
      command: process.execPath,
      cwd: directory,
    });
    const run = await adapter.start(activationEnvelope(), {
      recordUsageAggregate: async () => {
        attempts++;
        throw new Error("entry attribution conflict");
      },
      recordUsage: async (input) => {
        generations.push(input);
      },
      recordUsageGap: async (input) => {
        gaps.push(input);
      },
      registerPrepared: async () => undefined,
    });
    assert.equal((await adapter.reap(run)).code, 0);
    assert.equal(attempts, 1);
    const scope = { runAttemptId: "run-process-test", runtimeRunId: run.runId };
    assert.deepEqual(gaps, [
      {
        provider: aggregate.provider,
        reason: "parse_error",
        observedAt: aggregate.observedAt,
        ...scope,
      },
    ]);
    const { protocol: _protocol, ...fields } = generation;
    assert.deepEqual(generations, [{ ...fields, ...scope }]);
    assert.match(adapter.diagnostics(run).stderr, /entry attribution conflict/);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter applies activation-scoped arguments and sanitized setup diagnostics", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-process-launch-lease-"));
  try {
    const adapter = new GenericProcessAdapter({
      activationEnvironment: () => ({
        args: ["--managed-mcp", "loopback-runtime"],
        diagnostics: ["Managed MCP discovery unavailable [reason=fixture]"],
        env: {},
      }),
      args: [fakeCliPath],
      command: process.execPath,
      cwd: directory,
      env: { RAH_FAKE_MODE: "success" },
    });
    const run = await startProcess(adapter);
    assert.equal((await adapter.reap(run)).code, 0);
    const diagnostics = adapter.diagnostics(run);
    const output = JSON.parse(diagnostics.stdout) as { argv: string[] };
    assert.deepEqual(output.argv, ["--managed-mcp", "loopback-runtime"]);
    assert.match(
      diagnostics.stderr,
      /Managed MCP discovery unavailable \[reason=fixture\]/u,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter passes the frozen Agent configuration to the real process", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-agent-context-"));
  try {
    const adapter = new GenericProcessAdapter({
      args: [fakeCliPath],
      command: process.execPath,
      cwd: directory,
      env: { RAH_FAKE_MODE: "success" },
    });
    const envelope = activationEnvelope();
    const run = await startProcess(adapter, {
      ...envelope,
      agent: {
        agentDefinitionRevision: {
          agentId: "agent-definition-process-test",
          agentDefinitionRevisionId: "agent-definition-revision-process-test",
          contentDigest: `sha256:${"a".repeat(64)}`,
          createdAt: "2026-08-27T00:00:00.000Z",
          createdBy: "principal-owner",
          executionPolicyRevisionId: "execution-policy-process-test",
          instructionRefs: [],
          instructions: "Use the canonical Worker API and review carefully.",
          memoryPolicyRef: {
            artifactId: "memory-policy",
            contentDigest: `sha256:${"b".repeat(64)}`,
            versionId: "room-memory-v1",
          },
          revision: 1,
          role: "Production reviewer",
          skillRefs: [],
        },
        handle: "production-reviewer",
        participantId: envelope.participantId,
        schemaVersion: 1,
      },
    });
    const exit = await adapter.reap(run);
    const output = JSON.parse(adapter.diagnostics(run).stdout) as {
      agentHandle?: string;
      agentInstructions?: string;
      agentRole?: string;
    };

    assert.equal(exit.code, 0);
    assert.equal(output.agentRole, "Production reviewer");
    assert.equal(output.agentHandle, "production-reviewer");
    assert.equal(
      output.agentInstructions,
      "Use the canonical Worker API and review carefully.",
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter bounds opaque diagnostics", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-process-output-"));
  try {
    const adapter = new GenericProcessAdapter({
      args: [fakeCliPath],
      command: process.execPath,
      cwd: directory,
      diagnosticByteLimit: 64,
      env: { RAH_FAKE_MODE: "noisy" },
    });

    const run = await startProcess(adapter);
    await adapter.reap(run);
    const diagnostics = adapter.diagnostics(run);

    assert.ok(Buffer.byteLength(diagnostics.stdout) <= 64);
    assert.ok(Buffer.byteLength(diagnostics.stderr) <= 64);
    assert.equal(diagnostics.truncated, true);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter redacts secrets before diagnostic byte truncation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-process-redaction-"));
  try {
    const secret = "SENSITIVE_VALUE";
    const adapter = new GenericProcessAdapter({
      activationEnvironment: () => ({
        env: { RAH_TEST_SECRET: secret },
        redactions: [secret],
      }),
      args: ["-e", "process.stdout.write(process.env.RAH_TEST_SECRET ?? '')"],
      command: process.execPath,
      cwd: directory,
      diagnosticByteLimit: 5,
    });

    const run = await startProcess(adapter);
    await adapter.reap(run);
    const diagnostics = adapter.diagnostics(run);

    assert.equal(diagnostics.stdout, "[REDA");
    assert.equal(diagnostics.stdout.includes(secret.slice(0, 5)), false);
    assert.equal(diagnostics.truncated, true);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter redacts repeated long secrets without exposing a later prefix", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-os-process-repeat-redaction-"),
  );
  try {
    const secret = "ABCDEFGHIJ1234567890";
    const adapter = new GenericProcessAdapter({
      activationEnvironment: () => ({
        env: { RAH_TEST_SECRET: secret },
        redactions: [secret],
      }),
      args: [
        "-e",
        "process.stdout.write((process.env.RAH_TEST_SECRET ?? '').repeat(3))",
      ],
      command: process.execPath,
      cwd: directory,
      diagnosticByteLimit: 30,
    });

    const run = await startProcess(adapter);
    await adapter.reap(run);
    const diagnostics = adapter.diagnostics(run);

    assert.equal(diagnostics.stdout, "[REDACTED][REDACTED][REDACTED]");
    assert.equal(diagnostics.stdout.includes("ABCDEFGHI"), false);
    assert.equal(diagnostics.truncated, true);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter defers shorter overlapping secret matches across chunk boundaries", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-os-process-overlap-redaction-"),
  );
  try {
    const adapter = new GenericProcessAdapter({
      activationEnvironment: () => ({
        env: {},
        redactions: ["abcdef", "abc", "bc"],
      }),
      args: [
        "-e",
        [
          "process.stdout.write('a')",
          "setTimeout(() => process.stdout.write('bc'), 10)",
          "setTimeout(() => process.stdout.write('def'), 20)",
        ].join(";"),
      ],
      command: process.execPath,
      cwd: directory,
      diagnosticByteLimit: 64,
    });

    const run = await startProcess(adapter);
    await adapter.reap(run);
    const diagnostics = adapter.diagnostics(run);

    assert.equal(diagnostics.stdout, "[REDACTED]");
    assert.equal(diagnostics.stdout.includes("def"), false);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter redacts shifted and chained overlapping secrets", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-os-process-shifted-overlap-redaction-"),
  );
  try {
    const adapter = new GenericProcessAdapter({
      activationEnvironment: () => ({
        env: {},
        redactions: ["abc", "bcdef", "efghi"],
      }),
      args: [
        "-e",
        [
          "process.stdout.write('abc')",
          "setTimeout(() => process.stdout.write('def'), 10)",
          "setTimeout(() => process.stdout.write('ghi'), 20)",
        ].join(";"),
      ],
      command: process.execPath,
      cwd: directory,
      diagnosticByteLimit: 64,
    });

    const run = await startProcess(adapter);
    await adapter.reap(run);
    const diagnostics = adapter.diagnostics(run);

    assert.equal(diagnostics.stdout, "[REDACTED]");
    assert.equal(diagnostics.stdout.includes("def"), false);
    assert.equal(diagnostics.stdout.includes("ghi"), false);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter bounds dense overlapping redaction work", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-os-process-dense-overlap-redaction-"),
  );
  try {
    const adapter = new GenericProcessAdapter({
      activationEnvironment: () => ({
        env: {},
        redactions: Array.from({ length: 32 }, (_, index) =>
          "a".repeat(index + 1),
        ),
      }),
      args: ["-e", "process.stdout.write('a'.repeat(32_768))"],
      command: process.execPath,
      cwd: directory,
      diagnosticByteLimit: 64,
    });

    const run = await startProcess(adapter);
    await adapter.reap(run);
    assert.equal(adapter.diagnostics(run).stdout, "[REDACTED]");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test(
  "GenericProcessAdapter bounds EOF partial-prefix matching work",
  { timeout: 2_000 },
  async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "rah-os-process-eof-prefix-work-"),
    );
    try {
      const adapter = new GenericProcessAdapter({
        activationEnvironment: () => ({
          env: {},
          redactions: Array.from(
            { length: 64 },
            (_, index) =>
              `${"a".repeat(index === 0 ? 65_535 : 8_191)}${String.fromCharCode(33 + index)}`,
          ),
        }),
        args: ["-e", "process.stdout.write('a'.repeat(65_535) + 'c')"],
        command: process.execPath,
        cwd: directory,
        diagnosticByteLimit: 65_536,
      });

      const run = await startProcess(adapter);
      await adapter.reap(run);
      assert.equal(adapter.diagnostics(run).stdout, `${"a".repeat(65_535)}c`);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  },
);

test("GenericProcessAdapter redacts a Unicode secret split inside a UTF-8 code point", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-os-process-unicode-redaction-"),
  );
  try {
    const secret = "密钥🔐value";
    const adapter = new GenericProcessAdapter({
      activationEnvironment: () => ({
        env: { RAH_TEST_SECRET: secret },
        redactions: [secret],
      }),
      args: [
        "-e",
        [
          "const value = Buffer.from(process.env.RAH_TEST_SECRET ?? '')",
          "process.stdout.write(value.subarray(0, 2))",
          "setTimeout(() => process.stdout.write(value.subarray(2)), 10)",
        ].join(";"),
      ],
      command: process.execPath,
      cwd: directory,
      diagnosticByteLimit: 64,
    });

    const run = await startProcess(adapter);
    await adapter.reap(run);
    assert.equal(adapter.diagnostics(run).stdout, "[REDACTED]");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter preserves an unrelated Unicode code point at the safe boundary", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-os-process-unicode-boundary-"),
  );
  try {
    const adapter = new GenericProcessAdapter({
      activationEnvironment: () => ({
        env: {},
        redactions: ["XXXXXX"],
      }),
      args: ["-e", "process.stdout.write('A🔐BBBB')"],
      command: process.execPath,
      cwd: directory,
      diagnosticByteLimit: 64,
    });

    const run = await startProcess(adapter);
    await adapter.reap(run);
    assert.equal(adapter.diagnostics(run).stdout, "A🔐BBBB");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter redacts a secret prefix left pending at EOF", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-os-process-eof-redaction-"),
  );
  try {
    const adapter = new GenericProcessAdapter({
      activationEnvironment: () => ({
        env: {},
        redactions: ["abcdef"],
      }),
      args: ["-e", "process.stdout.write('abc')"],
      command: process.execPath,
      cwd: directory,
      diagnosticByteLimit: 64,
    });

    const run = await startProcess(adapter);
    await adapter.reap(run);
    assert.equal(adapter.diagnostics(run).stdout, "[REDACTED]");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter merges an EOF secret prefix with an overlapping match", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-os-process-eof-overlap-redaction-"),
  );
  try {
    const adapter = new GenericProcessAdapter({
      activationEnvironment: () => ({
        env: {},
        redactions: ["abcdef", "abc"],
      }),
      args: ["-e", "process.stdout.write('abcd')"],
      command: process.execPath,
      cwd: directory,
      diagnosticByteLimit: 64,
    });

    const run = await startProcess(adapter);
    await adapter.reap(run);
    assert.equal(adapter.diagnostics(run).stdout, "[REDACTED]");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter bounds retention of completed process runs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-process-retention-"));
  try {
    const adapter = new GenericProcessAdapter({
      args: [fakeCliPath],
      command: process.execPath,
      completedRunRetention: 1,
      cwd: directory,
      env: { RAH_FAKE_MODE: "success" },
    });

    const firstRun = await startProcess(adapter);
    await adapter.reap(firstRun);
    const secondRun = await startProcess(adapter, {
      ...activationEnvelope(),
      activationId: "activation-process-test-2",
      runAttemptId: "run-process-test-2",
    });
    await adapter.reap(secondRun);

    assert.throws(() => adapter.diagnostics(firstRun), /unknown process run/);
    assert.match(
      adapter.diagnostics(secondRun).stdout,
      /opaque-fake-cli-output/,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter releases an Activation environment when spawn fails", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-process-spawn-error-"));
  try {
    let releases = 0;
    const adapter = new GenericProcessAdapter({
      activationEnvironment: () => ({
        env: { TEST_ACTIVATION_TOKEN: "ephemeral-test-token" },
        release: () => {
          releases += 1;
        },
      }),
      command: join(directory, "executable-does-not-exist"),
      cwd: directory,
    });

    await assert.rejects(startProcess(adapter), /ENOENT/);
    assert.equal(releases, 1);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter scrubs inherited, static, and leased legacy Worker tokens", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-worker-env-scrub-"));
  try {
    const adapter = new GenericProcessAdapter({
      activationEnvironment: () => ({
        env: {
          RAH_WORKER_API_URL: "http://127.0.0.1:43123",
          RAH_WORKER_TOKEN: "leased-legacy-token",
          RAH_WORKER_SESSION_FILE: join(directory, "activation-token"),
        },
      }),
      args: [
        "-e",
        "process.stdout.write(JSON.stringify({api:process.env.RAH_WORKER_API_URL,cli:process.env.RAH_WORKER_CLI,file:process.env.RAH_WORKER_SESSION_FILE,legacyFile:process.env.RAH_WORKER_TOKEN_FILE,raw:process.env.RAH_WORKER_TOKEN}))",
      ],
      command: process.execPath,
      cwd: directory,
      env: {
        RAH_WORKER_API_URL: "https://untrusted-static.example.test",
        RAH_WORKER_CLI: "/untrusted/static/rah",
        RAH_WORKER_TOKEN: "static-legacy-token",
        RAH_WORKER_SESSION_FILE: "/untrusted/static/session",
        RAH_WORKER_TOKEN_FILE: "/untrusted/static/token",
      },
      supervisorDirectory: join(directory, "supervisors"),
    });

    const run = await startProcess(adapter);
    assert.equal((await adapter.reap(run)).code, 0);
    assert.deepEqual(JSON.parse(adapter.diagnostics(run).stdout), {
      api: "http://127.0.0.1:43123",
      file: join(directory, "activation-token"),
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter scrubs unleased Agent App Inbox and memory bootstrap values", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-app-inbox-env-scrub-"));
  const inheritedBootstrap = process.env.RAH_AGENT_MEMORY_BOOTSTRAP_JSON;
  try {
    process.env.RAH_AGENT_MEMORY_BOOTSTRAP_JSON = "untrusted-parent-memory";
    for (const staticBootstrap of [undefined, "untrusted-static-memory"]) {
      const adapter = new GenericProcessAdapter({
        activationEnvironment: () => ({ env: {} }),
        args: [
          "-e",
          "process.stdout.write(JSON.stringify({appInbox:process.env.RAH_AGENT_APP_INBOX_JSON,bootstrap:process.env.RAH_AGENT_MEMORY_BOOTSTRAP_JSON,sourceFile:process.env.RAH_AGENT_MEMORY_SOURCE_FILE,inboxApi:process.env.RAH_AGENT_INBOX_API_URL,inboxToken:process.env.RAH_AGENT_INBOX_SESSION_FILE,inboxCli:process.env.RAH_AGENT_INBOX_CLI}))",
        ],
        command: process.execPath,
        cwd: directory,
        env: {
          RAH_AGENT_APP_INBOX_JSON: "untrusted-static-app-item",
          RAH_AGENT_MEMORY_SOURCE_FILE: "/untrusted/static/source",
          RAH_AGENT_INBOX_API_URL: "https://untrusted.example",
          RAH_AGENT_INBOX_SESSION_FILE: "/untrusted/token",
          RAH_AGENT_INBOX_CLI: "/untrusted/cli",
          ...(staticBootstrap === undefined
            ? {}
            : { RAH_AGENT_MEMORY_BOOTSTRAP_JSON: staticBootstrap }),
        },
        supervisorDirectory: join(directory, "supervisors"),
      });
      const run = await startProcess(adapter);
      assert.equal((await adapter.reap(run)).code, 0);
      assert.deepEqual(JSON.parse(adapter.diagnostics(run).stdout), {});
    }
  } finally {
    if (inheritedBootstrap === undefined)
      delete process.env.RAH_AGENT_MEMORY_BOOTSTRAP_JSON;
    else process.env.RAH_AGENT_MEMORY_BOOTSTRAP_JSON = inheritedBootstrap;
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter awaits asynchronous Activation environment release before terminal reap", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-process-release-"));
  try {
    let releaseCompleted = false;
    let allowRelease!: () => void;
    let markReleaseStarted!: () => void;
    const releaseBarrier = new Promise<void>((resolve) => {
      allowRelease = resolve;
    });
    const releaseStarted = new Promise<void>((resolve) => {
      markReleaseStarted = resolve;
    });
    const adapter = new GenericProcessAdapter({
      activationEnvironment: () => ({
        env: {},
        release: async () => {
          markReleaseStarted();
          await releaseBarrier;
          releaseCompleted = true;
        },
      }),
      args: ["-e", "process.exit(0)"],
      command: process.execPath,
      cwd: directory,
      supervisorDirectory: join(directory, "supervisors"),
    });
    const handle = await adapter.start(activationEnvelope(), {
      registerPrepared: async () => undefined,
    });
    const reap = adapter.reap(handle);
    let reapSettled = false;
    void reap.finally(() => {
      reapSettled = true;
    });
    await releaseStarted;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(releaseCompleted, false);
    assert.equal(reapSettled, false);
    allowRelease();
    assert.equal((await reap).code, 0);
    assert.equal(releaseCompleted, true);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test(
  "GenericProcessAdapter rejects a supervisor directory writable by other users",
  { skip: process.platform === "win32" },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "rah-os-insecure-sup-"));
    try {
      chmodSync(directory, 0o755);
      const adapter = new GenericProcessAdapter({
        args: [fakeCliPath],
        command: process.execPath,
        cwd: directory,
        supervisorDirectory: directory,
      });
      await assert.rejects(startProcess(adapter), /not private/i);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  },
);

test(
  "GenericProcessAdapter cancels descendants in its dedicated process group",
  { skip: process.platform === "win32" },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "rah-os-process-group-"));
    try {
      const adapter = new GenericProcessAdapter({
        args: [fakeCliPath],
        command: process.execPath,
        cwd: directory,
        env: { RAH_FAKE_MODE: "ignore-term-with-child" },
        terminationGraceMs: 25,
      });
      const run = await startProcess(adapter);
      await waitForDiagnostic(adapter, run, "child-ready");
      const match = /child-ready pid=(\d+)/.exec(
        adapter.diagnostics(run).stderr,
      );
      assert.ok(match?.[1]);
      const childPid = Number(match[1]);

      await adapter.cancel(run);
      assert.equal((await adapter.reap(run)).signal, "SIGKILL");

      const deadline = Date.now() + 1_000;
      while (true) {
        try {
          process.kill(childPid, 0);
          if (Date.now() >= deadline) {
            assert.fail(`descendant process ${childPid} survived cancellation`);
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ESRCH"
          ) {
            break;
          }
          throw error;
        }
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  },
);

test("GenericProcessAdapter escalates an ignored SIGTERM to process-group SIGKILL", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-process-cancel-"));
  try {
    const adapter = new GenericProcessAdapter({
      args: [fakeCliPath],
      command: process.execPath,
      cwd: directory,
      env: { RAH_FAKE_MODE: "ignore-term" },
      terminationGraceMs: 25,
    });
    const run = await startProcess(adapter);
    await waitForDiagnostic(adapter, run);

    await adapter.cancel(run);
    const exit = await adapter.reap(run);
    const diagnostics = adapter.diagnostics(run);

    assert.equal(exit.code, null);
    assert.equal(exit.signal, "SIGKILL");
    assert.match(diagnostics.stderr, /ignored SIGTERM/);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test(
  "GenericProcessAdapter proves the process group is empty when its leader exits first",
  { skip: process.platform === "win32" },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "rah-os-group-proof-"));
    const pidFile = join(directory, "fixture-pids.json");
    let leaderPid: number | undefined;
    try {
      const adapter = new GenericProcessAdapter({
        args: [fakeCliPath],
        command: process.execPath,
        cwd: directory,
        env: {
          RAH_FAKE_MODE: "term-exits-with-stubborn-child",
          RAH_FAKE_PID_FILE: pidFile,
        },
        terminationGraceMs: 25,
      });
      const run = await startProcess(adapter);
      await waitForDiagnostic(adapter, run, "child-ready");
      const pids = JSON.parse(readFileSync(pidFile, "utf8")) as {
        childPid: number;
        leaderPid: number;
      };
      leaderPid = pids.leaderPid;

      const exit = await adapter.cancel(run);
      assert.deepEqual(exit, { code: null, signal: "SIGTERM" });
      assert.equal(processExists(pids.leaderPid), false);
      assert.equal(
        processExists(pids.childPid),
        false,
        "terminal proof requires every process-group descendant to be gone",
      );
      leaderPid = undefined;
    } finally {
      if (leaderPid !== undefined) {
        try {
          process.kill(-leaderPid, "SIGKILL");
        } catch (error) {
          if (!(
            error instanceof Error &&
            "code" in error &&
            error.code === "ESRCH"
          )) {
            throw error;
          }
        }
      }
      rmSync(directory, { force: true, recursive: true });
    }
  },
);

test(
  "GenericProcessAdapter closes unauthenticated half-open control connections at terminal",
  { skip: process.platform === "win32" },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "rah-os-half-open-"));
    try {
      const adapter = new GenericProcessAdapter({
        args: [fakeCliPath],
        command: process.execPath,
        cwd: directory,
        env: { RAH_FAKE_MODE: "ignore-term" },
        supervisorDirectory: directory,
        terminationGraceMs: 25,
      });
      const run = await startProcess(adapter);
      await waitForDiagnostic(adapter, run);
      assert.ok(run.recoveryDescriptor);
      const socketPath = join(
        `/tmp/rah-os-control-${String(process.getuid?.() ?? "user")}`,
        `${run.recoveryDescriptor.recoveryKey}.sock`,
      );
      const halfOpen = createConnection(socketPath);
      await new Promise<void>((resolve, reject) => {
        halfOpen.once("connect", resolve);
        halfOpen.once("error", reject);
      });
      const closed = new Promise<void>((resolve) =>
        halfOpen.once("close", () => resolve()),
      );

      await adapter.cancel(run);
      await closed;
      assert.equal(halfOpen.destroyed, true);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  },
);

test(
  "GenericProcessAdapter safely recovers a supervised process after its original host exits",
  { skip: process.platform === "win32" },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "rah-sup-"));
    const pidFile = join(directory, "fixture-pids.json");
    let leaderPid: number | undefined;
    let run: Awaited<ReturnType<GenericProcessAdapter["start"]>> | undefined;
    const recoveringAdapter = new GenericProcessAdapter({
      args: [fakeCliPath],
      command: process.execPath,
      cwd: directory,
      supervisorDirectory: directory,
      terminationGraceMs: 25,
    });

    try {
      assert.deepEqual(recoveringAdapter.recoveryDrivers, [
        "rah-process-supervisor-v1",
      ]);
      run = await launchFromDisposableHost({ directory, pidFile });
      const pids = JSON.parse(readFileSync(pidFile, "utf8")) as {
        childPid: number;
        leaderPid: number;
      };
      leaderPid = pids.leaderPid;
      assert.equal(processExists(pids.leaderPid), true);
      assert.equal(processExists(pids.childPid), true);
      assert.equal(run.recoveryDescriptor?.driver, "rah-process-supervisor-v1");
      assert.deepEqual(Object.keys(run.recoveryDescriptor?.metadata ?? {}), [
        "controlToken",
      ]);

      chmodSync(directory, 0o755);
      await assert.rejects(
        recoveringAdapter.recover!({
          recoveryDescriptor: run.recoveryDescriptor!,
          runAttemptId: "run-disposable-host",
          runtimeRunId: run.runId,
        }),
        /not private/i,
      );
      assert.equal(processExists(pids.leaderPid), true);
      assert.equal(processExists(pids.childPid), true);
      chmodSync(directory, 0o700);

      const forgedDescriptor = {
        ...run.recoveryDescriptor!,
        metadata: {
          ...run.recoveryDescriptor!.metadata,
          controlToken: "0".repeat(64),
        },
      };
      await assert.rejects(
        recoveringAdapter.recover!({
          recoveryDescriptor: forgedDescriptor,
          runAttemptId: "run-disposable-host",
          runtimeRunId: run.runId,
        }),
        /identity authentication failed/,
      );
      assert.equal(processExists(pids.leaderPid), true);
      assert.equal(processExists(pids.childPid), true);

      await assert.rejects(
        recoveringAdapter.recover!({
          recoveryDescriptor: run.recoveryDescriptor!,
          runAttemptId: "run-disposable-host",
          runtimeRunId: "wrong-runtime-run",
        }),
        /identity authentication failed/,
      );
      assert.equal(processExists(pids.leaderPid), true);
      assert.equal(processExists(pids.childPid), true);

      const recoveryInput = {
        recoveryDescriptor: run.recoveryDescriptor!,
        runAttemptId: "run-disposable-host",
        runtimeRunId: run.runId,
      };
      const exit = await recoveringAdapter.recover!(recoveryInput);
      assert.deepEqual(exit, { code: null, signal: "SIGKILL" });

      const deadline = Date.now() + 1_000;
      while (processExists(pids.leaderPid) || processExists(pids.childPid)) {
        if (Date.now() >= deadline) {
          assert.fail(
            "supervised process group survived authenticated recovery",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      assert.deepEqual(
        await recoveringAdapter.recover!(recoveryInput),
        exit,
        "a signed terminal result remains verifiable after the supervisor exits",
      );
      leaderPid = undefined;
    } finally {
      if (run?.recoveryDescriptor && recoveringAdapter.recover) {
        await recoveringAdapter
          .recover({
            recoveryDescriptor: run.recoveryDescriptor,
            runAttemptId: "run-disposable-host",
            runtimeRunId: run.runId,
          })
          .catch(() => undefined);
      }
      if (leaderPid !== undefined && processExists(leaderPid)) {
        process.kill(-leaderPid, "SIGKILL");
      }
      rmSync(directory, { force: true, recursive: true });
    }
  },
);

for (const supervised of [false, true])
  test(`session binding failure stops the owned runtime (${supervised ? "supervised" : "direct"})`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "rah-binding-failure-"));
    const adapter = new GenericProcessAdapter({
      command: process.execPath,
      args: [
        "-e",
        `require('node:fs').writeSync(3, JSON.stringify({protocol:'rah-provider-session/v1', provider:'fixture-provider/v1', providerSessionId:'unexpected', state:'ready'})+'\\n'); setInterval(()=>{},1000);`,
      ],
      cwd: directory,
      ...(supervised
        ? { supervisorDirectory: join(directory, "supervisors") }
        : {}),
      terminationGraceMs: 20,
      recordProviderSessionEvidence: async () => {
        throw new Error("disk write rejected");
      },
    });
    const run = await startProcess(adapter);
    try {
      const exit = await Promise.race([
        adapter.reap(run),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error("binding failure left process alive")),
            1500,
          );
          timer.unref();
        }),
      ]);
      assert.equal(exit.failure?.retryDisposition, "sticky_terminal");
      assert.match(exit.failure!.message, /RAH_SESSION_CONTINUITY_REQUIRED/);
      assert.equal(await adapter.isAlive(run), false);
    } finally {
      await adapter.cancel(run);
      rmSync(directory, { recursive: true, force: true });
    }
  });
