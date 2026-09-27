import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { WorkerApplicationService } from "@rah-os/application-service";
import { RoomKernel, type AuthenticatedHostContext } from "@rah-os/kernel";

import {
  AgentHost,
  CodexWarmAdapter,
  createKernelAgentHostControlPort,
  createSystemProcessTable,
  InstanceRuntimePool,
  LeftoverProcessSweeper,
  OPENCODE_WARM_DRIVER,
  renderBodiedWake,
  RuntimeImplementationRegistry,
  RuntimeProcessHygiene,
  RuntimeProfileRegistry,
  type RuntimeAdapter,
} from "../src/index.ts";

/**
 * S2-c3 warm OpenCode end to end with a FAKE long-lived `opencode serve`
 * (`fixtures/fake-opencode-server.mjs`, no model, no paid CLI): real Kernel
 * and SQLite, real Worker HTTP API and Worker CLI, the real OpenCode warm
 * driver, the shared warm adapter and pool, and AgentHost. The fake follows
 * the installed OpenCode 1.18.32 bundle (caller-chosen user messageID,
 * assistant `parentID`, the prompt's HTTP answer after the loop ended, abort,
 * live bus without replay). It cannot prove the real model loop; that is the
 * paid smoke gate.
 */
const fakePath = fileURLToPath(
  new URL("./fixtures/fake-opencode-server.mjs", import.meta.url),
);
const RULES = "FAKE standing prompt for the warm OpenCode test";

type Harness = Awaited<ReturnType<typeof harness>>;

async function harness(options: { env?: Record<string, string> } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "rah-warm-opencode-"));
  chmodSync(directory, 0o700);
  const socketRoot = mkdtempSync("/tmp/lwo-");
  chmodSync(socketRoot, 0o700);
  const recordPath = join(directory, "record.jsonl");
  const executable = join(directory, "opencode");
  writeFileSync(
    executable,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakePath)} "$@"\n`,
    { mode: 0o700 },
  );
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const worker = new WorkerApplicationService({ kernel });
  await worker.start();
  const human = kernel.provisionPrincipal({
    handle: "warm-human",
    kind: "human",
  });
  const agent = kernel.provisionPrincipal({
    handle: "warm-opencode",
    kind: "agent",
  });
  const participantId = agent.principal.principalId;
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "Warm", slug: "warm" });
  kernel.addMember(actor, { principalId: participantId, roomId: room.roomId });
  const hostToken = kernel.provisionHostCredential({
    hostId: "warm-host",
    participantIds: [participantId],
  }).accessToken;
  const sessions = new Map<string, string>();
  /** Prompts the fake had received when each binding was persisted. */
  const promptsAtBinding: number[] = [];
  const acceptances: { inputSha256?: string; turnId: string }[] = [];
  const hygiene = new RuntimeProcessHygiene({
    sweeper: new LeftoverProcessSweeper({
      graceMs: 300,
      table: createSystemProcessTable(),
    }),
  });
  let messages = 0;

  function readRecords(): Record<string, unknown>[] {
    if (!existsSync(recordPath)) return [];
    return readFileSync(recordPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  const makeHost = (host: AuthenticatedHostContext) => {
    const control = createKernelAgentHostControlPort(kernel, host);
    const pool = new InstanceRuntimePool({
      control,
      hostGeneration: host.instanceId,
      hygiene,
      idleTtlMs: 60_000,
      socketRoot,
      stateDirectory: join(directory, "warm-runtimes"),
    });
    const legacy: RuntimeAdapter = {
      async probe() {
        return { available: true };
      },
      async start() {
        throw new Error("the per-turn path is not used in this test");
      },
      async cancel() {
        throw new Error("unused");
      },
      async reap() {
        throw new Error("unused");
      },
    };
    const adapter = new CodexWarmAdapter({
      driver: OPENCODE_WARM_DRIVER,
      cwd: directory,
      driverArgs: [
        "--executable",
        executable,
        "--tool-access-mode",
        "full_access",
        "--prompt",
        RULES,
      ],
      env: {
        FAKE_RECORD: recordPath,
        FAKE_RELEASE: join(directory, "never-released"),
        FAKE_FOLLOW_UP_MS: "300",
        ...options.env,
      },
      isWarm: () => true,
      issueWorkerCredential: async (input) =>
        worker.issueActivationCredential(host, input),
      legacy,
      pool,
      recordDeliveryAcceptance: (input, acceptance) => {
        // As the daemon does: the Host credential registers the send, so the
        // bodied wake's post confirms delivery without a message-check.
        kernel.markPresentedDeliverySent(host, {
          activationId: input.activationId,
          consumerId: input.consumerId,
          runAttemptId: input.runAttemptId,
        });
        acceptances.push({
          turnId: acceptance.turnId,
          ...(acceptance.inputSha256 === undefined
            ? {}
            : { inputSha256: acceptance.inputSha256 }),
        });
      },
      recordProviderSessionEvidence: (input, evidence) => {
        promptsAtBinding.push(
          readRecords().filter((record) => record.event === "prompt").length,
        );
        sessions.set(input.participantId, evidence.providerSessionId);
      },
      renderWake: async (input) =>
        await renderBodiedWake({
          env: input.env,
          participantId: input.participantId,
          turnHandle: input.turnHandle,
        }),
      runtimeEnvironment: async (input) => {
        const previous = sessions.get(input.participantId);
        return {
          args: previous === undefined ? [] : ["--resume-session", previous],
          env: {},
        };
      },
      runtimeKey: () => "fake-key",
      workerApiOrigin: worker.origin,
    });
    const agentHost = new AgentHost({
      drainTimeoutMs: 300,
      guideEnabled: () => true,
      host,
      kernel,
      leaseMs: 30_000,
      pollIntervalMs: 20,
      retryAfterMs: 0,
      runtime: adapter,
    });
    return { adapter, agentHost, control, host, pool };
  };

  const host = kernel.authenticateHostAccessToken(hostToken);
  kernel.heartbeatHost(host);
  const current = makeHost(host);

  return {
    acceptances,
    current,
    databasePath,
    kernel,
    participantId,
    promptsAtBinding,
    post(body: string) {
      messages += 1;
      return kernel.postMessage(actor, {
        body,
        idempotencyKey: `warm-message-${messages}`,
        recipients: [{ participantId, reason: "mention" }],
        roomId: room.roomId,
      });
    },
    records: readRecords,
    roomId: room.roomId,
    sessions,
    async cleanup() {
      await current.pool.shutdown().catch(() => undefined);
      await worker.close();
      kernel.close();
      rmSync(socketRoot, { force: true, recursive: true });
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

function sql(state: Harness, query: string, ...args: string[]) {
  const database = new DatabaseSync(state.databasePath, { readOnly: true });
  try {
    return database.prepare(query).all(...args) as Record<string, unknown>[];
  } finally {
    database.close();
  }
}

async function waitFor<T>(
  probe: () => T | undefined | false,
  label: string,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const events = (state: Harness, event: string) =>
  state.records().filter((record) => record.event === event);
const spawns = (state: Harness) => events(state, "spawn");
const prompts = (state: Harness) => events(state, "prompt");
const requests = (state: Harness, method: string, path: string) =>
  events(state, "request").filter(
    (record) => record.method === method && record.path === path,
  );
const orderedRuns = (state: Harness) =>
  state.kernel
    .listRunAttempts({ roomId: state.roomId })
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

test("warm OpenCode: three Activations run on one server and one session, each accepted by its own messageID and quiesced", async () => {
  const state = await harness({ env: { FAKE_SCENARIO: "nofinal" } });
  try {
    for (let turn = 1; turn <= 3; turn += 1) {
      state.post(`question ${turn}`);
      const result = await state.current.agentHost.reconcileOnce();
      assert.equal(result.state, "completed", JSON.stringify(result));
    }
    assert.equal(spawns(state).length, 1, "one opencode serve");
    assert.equal(requests(state, "POST", "/session").length, 1);
    // evo §40 B2: same session rules as the per-turn driver.
    assert.deepEqual(
      (requests(state, "POST", "/session")[0]!.body as { permission: unknown })
        .permission,
      [
        { action: "allow", pattern: "*", permission: "*" },
        { action: "deny", pattern: "*", permission: "question" },
        { action: "deny", pattern: "*", permission: "plan_enter" },
        { action: "deny", pattern: "*", permission: "plan_exit" },
      ],
    );
    const sent = prompts(state);
    assert.equal(sent.length, 3);
    const ids = sent.map((record) => String(record.messageID));
    assert.equal(new Set(ids).size, 3);
    for (const record of sent) assert.equal(record.system, undefined);
    const handles = sent.map(
      (record) => /--turn (\S+)/u.exec(String(record.text))?.[1],
    );
    assert.ok(handles.every((handle) => handle !== undefined));
    assert.equal(new Set(handles).size, 3, "each turn has its own handle");
    for (const command of events(state, "command"))
      assert.equal(
        (command.exit as { exitCode: number }).exitCode,
        0,
        String(command.output),
      );
    // The rules ride in the server's instructions for every model request.
    const [rulesPath] = (spawns(state)[0]!.config as { instructions: string[] })
      .instructions;
    for (const step of events(state, "model-request"))
      assert.ok(
        (step.system as string[]).includes(
          `Instructions from: ${rulesPath}\n${RULES}`,
        ),
      );
    const runs = orderedRuns(state);
    assert.deepEqual(
      runs.map((run) => run.nativeTurnId),
      ids,
    );
    assert.equal(new Set(runs.map((run) => run.instanceRuntimeId)).size, 1);
    assert.deepEqual(
      sql(
        state,
        "SELECT execution_mode FROM run_attempts ORDER BY started_at",
      ).map((row) => row.execution_mode),
      ["cold", "warm", "warm"],
    );
    assert.deepEqual(
      state.acceptances.map((acceptance) => acceptance.turnId),
      ids,
    );
    for (const [index, acceptance] of state.acceptances.entries())
      assert.equal(
        acceptance.inputSha256,
        createHash("sha256")
          .update(String(sent[index]!.text), "utf8")
          .digest("hex"),
      );
    // The session exists at ready: bound before any prompt.
    assert.deepEqual(state.promptsAtBinding, [0]);
    for (const process of state.kernel.listRuntimeProcesses({
      roomId: state.roomId,
    })) {
      assert.equal(process.proofKind, "turn_quiesced");
      assert.equal(process.quiesceResult, "success");
    }
    const [row] = sql(state, "SELECT state, pid FROM instance_runtimes");
    assert.equal(row?.state, "idle");
    assert.ok(alive(Number(row?.pid)));
  } finally {
    await state.cleanup();
  }
});

// Review 2026-09-26 P1-1: a warm runtime that resumes a pre-rules
// (allow-all) session installs the deny rules through the shared
// install-and-verify step before it reports ready, so before any input.
test("warm OpenCode resume: a pre-rules allow-all session gets the deny rules installed and verified before the first prompt", async () => {
  const state = await harness({ env: { FAKE_SCENARIO: "nofinal" } });
  try {
    state.sessions.set(state.participantId, "ses_fakelegacy");
    state.post("question");
    const result = await state.current.agentHost.reconcileOnce();
    assert.equal(result.state, "completed", JSON.stringify(result));
    const records = state.records();
    const patch = records.findIndex((r) => r.event === "permission-patch");
    assert.ok(patch >= 0, "rules installed on the resumed session");
    assert.deepEqual(records[patch]!.permission, [
      { action: "deny", pattern: "*", permission: "question" },
      { action: "deny", pattern: "*", permission: "plan_enter" },
      { action: "deny", pattern: "*", permission: "plan_exit" },
    ]);
    const verify = records.findIndex(
      (r, position) =>
        position > patch &&
        r.event === "request" &&
        r.method === "GET" &&
        r.path === "/session/ses_fakelegacy",
    );
    assert.ok(verify > patch, "read back");
    assert.ok(
      verify < records.findIndex((r) => r.event === "prompt"),
      "before the prompt",
    );
    assert.equal(requests(state, "POST", "/session").length, 0);
  } finally {
    await state.cleanup();
  }
});

test("warm OpenCode resume: a failed rule installation ends the runtime with a diagnostic, sends no prompt and creates no session", async () => {
  const state = await harness({
    env: { FAKE_SCENARIO: "nofinal", FAKE_PATCH_FAIL: "1" },
  });
  try {
    state.sessions.set(state.participantId, "ses_fakelegacy");
    state.post("question");
    const result = await state.current.agentHost.reconcileOnce();
    assert.notEqual(result.state, "completed", JSON.stringify(result));
    assert.equal(events(state, "permission-patch").length, 1);
    assert.equal(prompts(state).length, 0, "no input submitted");
    assert.equal(requests(state, "POST", "/session").length, 0);
    assert.match(
      JSON.stringify(state.kernel.listRunAttempts({ roomId: state.roomId })),
      /OpenCode session permission/u,
    );
  } finally {
    await state.cleanup();
  }
});

// evo §57/§59: the warm server gets the same user MCP isolation as the
// per-turn driver: names from `debug config --pure`, each `enabled: false`,
// and `GET /mcp` before the runtime is ready; a server it could not switch
// off ends the launch before any prompt.
test("warm OpenCode user MCP: the user's MCP servers are switched off and verified before the first prompt", async () => {
  const state = await harness({
    env: {
      FAKE_SCENARIO: "nofinal",
      FAKE_USER_CONFIG: JSON.stringify({
        mcp: { usermarker: { type: "local", command: ["/usr/bin/false"] } },
      }),
    },
  });
  try {
    state.post("question");
    const result = await state.current.agentHost.reconcileOnce();
    assert.equal(result.state, "completed", JSON.stringify(result));
    const records = state.records();
    const at = (predicate: (r: Record<string, unknown>) => boolean) =>
      records.findIndex(predicate);
    const resolved = at((r) => r.event === "debug-config");
    assert.ok(resolved >= 0 && resolved < at((r) => r.event === "spawn"));
    assert.deepEqual((spawns(state)[0]!.config as { mcp?: unknown }).mcp, {
      usermarker: { enabled: false },
    });
    const verified = at(
      (r) => r.event === "request" && r.method === "GET" && r.path === "/mcp",
    );
    assert.ok(verified >= 0 && verified < at((r) => r.event === "prompt"));
  } finally {
    await state.cleanup();
  }
});

test("warm OpenCode user MCP: a server the launch could not switch off ends the launch before any prompt", async () => {
  const state = await harness({
    env: { FAKE_SCENARIO: "nofinal", FAKE_SERVE_EXTRA_MCP: "1" },
  });
  try {
    state.post("question");
    const result = await state.current.agentHost.reconcileOnce();
    assert.notEqual(result.state, "completed", JSON.stringify(result));
    assert.equal(prompts(state).length, 0, "no input submitted");
  } finally {
    await state.cleanup();
  }
});

test("warm OpenCode final reply: the committed --final post ends the run with POST /abort, quiesces as success, and the server continues", async () => {
  const state = await harness({ env: { FAKE_SCENARIO: "reply" } });
  try {
    for (let turn = 1; turn <= 2; turn += 1) {
      state.post(`question ${turn}`);
      const result = await state.current.agentHost.reconcileOnce();
      assert.equal(result.state, "completed", JSON.stringify(result));
    }
    assert.deepEqual(events(state, "follow-up-generation"), []);
    const aborts = events(state, "abort");
    assert.equal(aborts.length, 2);
    assert.ok(aborts.every((record) => record.toolRunning === false));
    for (const run of orderedRuns(state)) {
      assert.equal(run.state, "exited");
      const [row] = sql(
        state,
        "SELECT interrupt_sent, preempted_follow_up FROM run_attempt_final_replies WHERE run_attempt_id = ?",
        run.runAttemptId,
      );
      assert.deepEqual(
        { ...row },
        { interrupt_sent: 1, preempted_follow_up: "true" },
      );
    }
    for (const process of state.kernel.listRuntimeProcesses({
      roomId: state.roomId,
    })) {
      assert.equal(process.proofKind, "turn_quiesced");
      assert.equal(process.quiesceResult, "success");
    }
    assert.equal(spawns(state).length, 1, "the server survives");
  } finally {
    await state.cleanup();
  }
});

test("warm OpenCode final reply: a non-abort session error before the final abort is kept; the turn is not quiesced as success", async () => {
  const state = await harness({ env: { FAKE_SCENARIO: "reply+sideerror" } });
  try {
    state.post("question");
    await state.current.agentHost.reconcileOnce();
    assert.equal(events(state, "abort").length, 1, "the final abort ran");
    const [run] = orderedRuns(state);
    const [marker] = sql(
      state,
      "SELECT interrupt_sent FROM run_attempt_final_replies WHERE run_attempt_id = ?",
      run!.runAttemptId,
    );
    assert.equal(marker?.interrupt_sent, 1);
    const [process] = state.kernel.listRuntimeProcesses({
      roomId: state.roomId,
    });
    assert.notEqual(
      process?.quiesceResult,
      "success",
      "an independent error is never hidden by the final end",
    );
    assert.match(
      JSON.stringify(state.kernel.listRunAttempts({ roomId: state.roomId })),
      /FAKE independent session failure/u,
      "the Host keeps the failure text",
    );
  } finally {
    await state.cleanup();
  }
});

test("review batch 1 #4: warm OpenCode: a context overflow recovered by auto-compaction is a diagnostic; the turn completes and is not retried", async () => {
  const state = await harness({ env: { FAKE_SCENARIO: "nofinal+overflow" } });
  try {
    state.post("question");
    const result = await state.current.agentHost.reconcileOnce();
    assert.equal(result.state, "completed", JSON.stringify(result));
    assert.equal(events(state, "context-overflow").length, 1);
    assert.equal(prompts(state).length, 1, "never re-executed");
    const [process] = state.kernel.listRuntimeProcesses({
      roomId: state.roomId,
    });
    assert.equal(process?.quiesceResult, "success");
    assert.equal(spawns(state).length, 1, "the server was kept");
  } finally {
    await state.cleanup();
  }
});

test("review batch 1 #5: warm OpenCode: a subagent's (child session) permission request is answered like the parent session's", async () => {
  const state = await harness({ env: { FAKE_SCENARIO: "nofinal+childperm" } });
  try {
    state.post("question");
    const result = await state.current.agentHost.reconcileOnce();
    assert.equal(result.state, "completed", JSON.stringify(result));
    const [asked] = events(state, "child-permission");
    assert.equal(asked?.reply, "always");
  } finally {
    await state.cleanup();
  }
});

/**
 * Full review batch 3 (Codex re-review P2-1): after an SSE gap the warm
 * driver re-reads the installed 1.18.32 pending requests (`GET /permission`,
 * `GET /question`) and verifies an unknown asking session's lineage (`GET
 * /session/:id` `parentID`) before answering it with the turn's rule.
 */
test("batch 3: warm OpenCode: a child permission whose session.created was lost is answered after its lineage is verified", async () => {
  const state = await harness({
    env: { FAKE_SCENARIO: "nofinal+childnocreated" },
  });
  try {
    state.post("question");
    const result = await state.current.agentHost.reconcileOnce();
    assert.equal(result.state, "completed", JSON.stringify(result));
    const [asked] = events(state, "child-permission");
    assert.equal(asked?.reply, "always");
    assert.ok(
      requests(state, "GET", `/session/${String(asked?.child)}`).length >= 1,
    );
  } finally {
    await state.cleanup();
  }
});

test("batch 3: warm OpenCode: a child permission lost in an SSE gap is found in GET /permission after the reconnect and answered", async () => {
  const state = await harness({
    env: { FAKE_SCENARIO: "nofinal+childpermdrop" },
  });
  try {
    state.post("question");
    const result = await state.current.agentHost.reconcileOnce();
    assert.equal(result.state, "completed", JSON.stringify(result));
    assert.equal(events(state, "sse-dropped").length, 1);
    const [asked] = events(state, "child-permission");
    assert.equal(asked?.reply, "always");
    assert.ok(requests(state, "GET", "/permission").length >= 1);
    assert.equal(prompts(state).length, 1, "never resent");
  } finally {
    await state.cleanup();
  }
});

test("batch 3: warm OpenCode: a child session's step-finish usage is recorded for the run", async () => {
  const state = await harness({ env: { FAKE_SCENARIO: "nofinal+childperm" } });
  try {
    state.post("question");
    const result = await state.current.agentHost.reconcileOnce();
    assert.equal(result.state, "completed", JSON.stringify(result));
    const [usage] = events(state, "child-usage");
    const [run] = orderedRuns(state);
    assert.deepEqual(
      sql(
        state,
        "SELECT response_id, input_tokens, output_tokens FROM run_attempt_usage WHERE run_attempt_id = ?",
        run!.runAttemptId,
      ).map((row) => [row.response_id, row.input_tokens, row.output_tokens]),
      [[usage!.partId, 50, 5]],
    );
  } finally {
    await state.cleanup();
  }
});

test("batch 3: warm OpenCode: a context overflow OpenCode did not recover from fails the turn and keeps the accepted session bound", async () => {
  const state = await harness({
    env: { FAKE_SCENARIO: "nofinal+overflowfatal" },
  });
  try {
    state.post("question");
    const result = await state.current.agentHost.reconcileOnce();
    assert.equal(events(state, "overflow-unrecovered").length, 1);
    assert.notEqual(result.state, "completed", JSON.stringify(result));
    const [process] = state.kernel.listRuntimeProcesses({
      roomId: state.roomId,
    });
    assert.notEqual(process?.quiesceResult, "success");
    assert.match(
      JSON.stringify(state.kernel.listRunAttempts({ roomId: state.roomId })),
      /too long for the context window/u,
    );
    assert.equal(state.acceptances.length, 1, "the loop took the input");
    assert.equal(
      state.sessions.get(state.participantId),
      "ses_fakenew",
      "the accepted session stays bound",
    );
  } finally {
    await state.cleanup();
  }
});

test("warm OpenCode P2-2: a final abort still in flight when the prompt answers holds the next turn until it is answered", async () => {
  const state = await harness({
    env: { FAKE_SCRIPT: "reply,nofinal", FAKE_ABORT_DELAY_MS: "800" },
  });
  try {
    state.post("question 1");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    state.post("question 2");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    const records = state.records();
    const answered = records.findIndex((r) => r.event === "abort-answered");
    const secondPrompt = records.findIndex(
      (r, index) =>
        r.event === "prompt" &&
        records.slice(0, index).some((p) => p.event === "prompt"),
    );
    assert.ok(answered >= 0, "the abort was answered");
    assert.ok(
      secondPrompt > answered,
      "the next prompt starts only after the abort's answer",
    );
    assert.equal(spawns(state).length, 1, "a known outcome keeps the server");
  } finally {
    await state.cleanup();
  }
});

test("warm OpenCode P2-2: an abort with an unknown outcome retires the server before the drain; the next turn continues the same session without resending", async () => {
  const state = await harness({
    env: { FAKE_SCRIPT: "reply,nofinal", FAKE_ABORT_DROP: "1" },
  });
  try {
    state.post("question 1");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    const firstSession = state.sessions.get(state.participantId);
    assert.equal(spawns(state).length, 2, "the old server was replaced");
    state.post("question 2");
    for (let i = 0; i < 4; i += 1) {
      const next = await state.current.agentHost.reconcileOnce();
      if (next.state === "idle") break;
    }
    // The fake restarts its script per server, so the second turn is a final
    // reply again: one fresh server per dropped abort, never more.
    assert.equal(
      spawns(state).length,
      1 + events(state, "abort-dropped").length,
    );
    assert.ok(
      orderedRuns(state).every((run) => run.state === "exited"),
      "both turns completed",
    );
    assert.equal(prompts(state).length, 2, "no prompt was resent");
    assert.equal(state.sessions.get(state.participantId), firstSession);
    assert.equal(
      requests(state, "POST", "/session").length,
      1,
      "no replacement session",
    );
    assert.ok(
      requests(state, "GET", `/session/${String(firstSession)}`).length >= 1,
      "the fresh server resumed the recorded session",
    );
  } finally {
    await state.cleanup();
  }
});

test("warm OpenCode eighth review P1-1: an idle (unprompted-run) abort with an unknown outcome keeps admission closed until the old server is proven gone; the next turn runs on a fresh server in the same session without resending", async () => {
  const state = await harness({
    env: {
      FAKE_SCRIPT: "nofinal+autonomous,nofinal",
      FAKE_ABORT_DROP: "1",
      FAKE_TERM_DELAY_MS: "600",
    },
  });
  try {
    state.post("question 1");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    const oldPid = Number(spawns(state)[0]!.pid);
    await waitFor(
      () => events(state, "abort-dropped").length === 1,
      "the idle abort was dropped",
    );
    // The next message arrives while the old server may still receive the
    // unknown abort (it takes 600 ms to exit after SIGTERM).
    state.post("question 2");
    for (let i = 0; i < 20; i += 1) {
      await state.current.agentHost.reconcileOnce();
      if (
        orderedRuns(state).some(
          (run, index) => index > 0 && run.state === "exited",
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const records = state.records();
    const dropped = records.findIndex((r) => r.event === "abort-dropped");
    const oldExit = records.findIndex(
      (r) => r.event === "signal" && Number(r.pid) === oldPid,
    );
    const sent = prompts(state);
    assert.equal(sent.length, 2, "no prompt was resent");
    assert.equal(Number(sent[0]!.pid), oldPid);
    assert.notEqual(
      Number(sent[1]!.pid),
      oldPid,
      "the next turn never entered the old server",
    );
    const secondPrompt = records.findIndex(
      (r) => r.event === "prompt" && Number(r.pid) !== oldPid,
    );
    assert.ok(dropped >= 0 && oldExit > dropped && secondPrompt > oldExit);
    // The second turn was begun while the old server was still alive (it
    // exits 600 ms after SIGTERM): the barrier held it, not the timing.
    const secondRun = orderedRuns(state)[1]!;
    assert.ok(
      Date.parse(secondRun.startedAt) < Number(records[oldExit]!.at) + 600,
      "the second turn started inside the retirement window",
    );
    assert.equal(spawns(state).length, 2, "one replacement server");
    assert.ok(
      orderedRuns(state).some(
        (run, index) => index > 0 && run.state === "exited",
      ),
      "the second question completed",
    );
    assert.equal(
      requests(state, "POST", "/session").length,
      1,
      "no replacement session",
    );
    const session = state.sessions.get(state.participantId);
    assert.ok(
      events(state, "request").some(
        (r) =>
          r.method === "GET" &&
          r.path === `/session/${String(session)}` &&
          Number(r.pid) !== oldPid,
      ),
      "the fresh server resumed the recorded session",
    );
  } finally {
    await state.cleanup();
  }
});

test("warm OpenCode eighth review P1-1: when the server cannot be replaced after an unknown idle abort, the whole runtime ends and the held turn is never sent", async () => {
  const state = await harness({
    env: {
      FAKE_SCRIPT: "nofinal+autonomous,nofinal",
      FAKE_ABORT_DROP: "1",
      FAKE_FAIL_RESPAWN: "1",
      FAKE_TERM_DELAY_MS: "300",
    },
  });
  try {
    state.post("question 1");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    const oldPid = Number(spawns(state)[0]!.pid);
    await waitFor(
      () => events(state, "abort-dropped").length === 1,
      "the idle abort was dropped",
    );
    state.post("question 2");
    await state.current.agentHost.reconcileOnce();
    await waitFor(
      () => events(state, "respawn-failed").length >= 1,
      "the replacement failed",
    );
    await waitFor(
      () =>
        sql(state, "SELECT state FROM instance_runtimes")[0]?.state ===
        "terminated",
      "the warm runtime ended",
    );
    assert.deepEqual(
      prompts(state).map((record) => Number(record.pid)),
      [oldPid],
      "the held turn never reached any server",
    );
    assert.notEqual(orderedRuns(state)[1]?.state, "exited");
  } finally {
    await state.cleanup();
  }
});

test("warm OpenCode: cancel aborts the running loop, the server survives, and the retry runs on it", async () => {
  const state = await harness({
    env: { FAKE_SCRIPT: "nofinal,hang,nofinal,nofinal" },
  });
  try {
    state.post("warm up");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    state.post("long work");
    const controller = new AbortController();
    const running = state.current.agentHost.run({ signal: controller.signal });
    await waitFor(() => events(state, "tool-running").length === 2, "hang");
    // Admitted (the Host saw the acceptance) before the cancel.
    await waitFor(() => state.acceptances.length === 2, "acceptance");
    controller.abort();
    await running;
    assert.equal(events(state, "abort").length, 1);
    const runs = orderedRuns(state);
    assert.equal(runs[1]?.state, "cancelled");
    const cancelled = state.kernel
      .listRuntimeProcesses({ roomId: state.roomId })
      .find((process) => process.runAttemptId === runs[1]!.runAttemptId);
    assert.equal(cancelled?.proofKind, "turn_quiesced");
    assert.equal(cancelled?.quiesceResult, "cancelled");
    const [row] = sql(state, "SELECT state, pid FROM instance_runtimes");
    assert.equal(row?.state, "idle");
    assert.ok(alive(Number(row?.pid)));
    for (let i = 0; i < 4; i += 1) {
      const next = await state.current.agentHost.reconcileOnce();
      if (next.state === "idle") break;
    }
    assert.ok(orderedRuns(state).length >= 3, "later turns ran after it");
    assert.equal(spawns(state).length, 1);
  } finally {
    await state.cleanup();
  }
});

test("warm OpenCode: an SSE drop before acceptance is reconciled from the message listing, never by resending the prompt", async () => {
  const state = await harness({ env: { FAKE_SCRIPT: "ssedrop+nofinal" } });
  try {
    state.post("question");
    const result = await state.current.agentHost.reconcileOnce();
    assert.equal(result.state, "completed", JSON.stringify(result));
    assert.equal(events(state, "sse-dropped").length, 1);
    const sent = prompts(state);
    assert.equal(sent.length, 1, "the prompt was never resent");
    assert.ok(
      requests(state, "GET", "/session/ses_fakenew/message").length >= 1,
      "reconciled from the persisted messages",
    );
    assert.deepEqual(
      state.acceptances.map((acceptance) => acceptance.turnId),
      [sent[0]!.messageID],
    );
    assert.ok(events(state, "request").some((r) => r.path === "/event"));
    assert.equal(
      events(state, "request").filter((r) => r.path === "/event").length,
      2,
      "one reconnect",
    );
  } finally {
    await state.cleanup();
  }
});

test("warm OpenCode: a server crash while idle is recorded; the next message cold-starts and resumes the same session", async () => {
  const state = await harness({ env: { FAKE_SCENARIO: "nofinal" } });
  try {
    state.post("first");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    process.kill(Number(spawns(state)[0]!.pid), "SIGKILL");
    await waitFor(
      () =>
        sql(state, "SELECT state FROM instance_runtimes")[0]?.state ===
        "terminated",
      "idle crash record",
    );
    state.post("second");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    assert.equal(spawns(state).length, 2, "a second server");
    assert.equal(
      requests(state, "POST", "/session").length,
      1,
      "no replacement session",
    );
    assert.ok(requests(state, "GET", "/session/ses_fakenew").length >= 1);
    const sent = prompts(state);
    assert.equal(sent.length, 2);
  } finally {
    await state.cleanup();
  }
});

test("the registry builds the warm OpenCode adapter for opencode-server/v1 without busy input", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-warm-opencode-registry-"));
  chmodSync(directory, 0o700);
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  kernel.initialize();
  try {
    const executable = join(directory, "opencode");
    writeFileSync(
      executable,
      `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakePath)} "$@"\n`,
      { mode: 0o700 },
    );
    const agent = kernel.provisionPrincipal({ handle: "reg", kind: "agent" });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "reg-host",
        participantIds: [agent.principal.principalId],
      }).accessToken,
    );
    kernel.heartbeatHost(host);
    const profiles = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "reg-host",
    });
    profiles.initialize();
    const implementations = new RuntimeImplementationRegistry();
    const revision = profiles.importManifest({
      adapter: {
        config: { diagnosticByteLimit: 262_144, terminationGraceMs: 1_000 },
        executable,
        fixedArgs: [],
        kind: "opencode-server/v1",
      },
      credentialSlots: [],
      declaredCapabilities: ["worker_commands"],
      displayName: "FAKE opencode-server/v1",
      manifestVersion: 3,
      modelCatalogProbe: { kind: "opencode-cli/v1" },
      protocolFamily: "rah-worker-process/v1",
      recoveryDrivers: ["rah-process-supervisor-v1"],
      runtimeProfileId: "fake-opencode",
      staticEnv: {},
      workspacePolicy: { allowedModes: ["in_place"] },
    });
    const report = profiles.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: directory }),
    );
    const active = profiles.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    const adapter = implementations.createWarmRuntime(
      active,
      report,
      { cwd: directory },
      {
        issueWorkerCredential: async () => ({
          accessToken: "unused",
          revoke: () => undefined,
        }),
        pool: new InstanceRuntimePool({
          control: createKernelAgentHostControlPort(kernel, host),
          hostGeneration: host.instanceId,
          stateDirectory: join(directory, "warm"),
        }),
        runtimeEnvironment: async () => ({ env: {} }),
        workerApiOrigin: "http://127.0.0.1:9",
      },
      undefined,
      "full_access",
    );
    assert.equal(adapter.guideRuntimeId, "opencode");
    assert.equal(adapter.busyInputSupported, false);
    profiles.close();
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
