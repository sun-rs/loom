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
          agentDefinitionId: "agent-definition-process-test",
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
        participantId: envelope.participantId,
        schemaVersion: 1,
      },
    });
    const exit = await adapter.reap(run);
    const output = JSON.parse(adapter.diagnostics(run).stdout) as {
      agentInstructions?: string;
      agentRole?: string;
    };

    assert.equal(exit.code, 0);
    assert.equal(output.agentRole, "Production reviewer");
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
        env: { RAH_WORKER_TOKEN: "ephemeral-test-token" },
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
