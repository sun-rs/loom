import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

const mode = process.env.RAH_FAKE_MODE ?? "success";
const agentContext =
  process.env.RAH_AGENT_CONTEXT_JSON === undefined
    ? undefined
    : JSON.parse(process.env.RAH_AGENT_CONTEXT_JSON);
const contextManifest =
  process.env.RAH_CONTEXT_MANIFEST_JSON === undefined
    ? undefined
    : JSON.parse(process.env.RAH_CONTEXT_MANIFEST_JSON);
let trajectorySequence = 0;

function publishTrajectory(entry) {
  trajectorySequence += 1;
  try {
    writeSync(
      3,
      `${JSON.stringify({
        entry,
        observedAt: new Date().toISOString(),
        producerSequence: trajectorySequence,
      })}\n`,
    );
  } catch {
    // Some unit fixtures invoke this executable without the activity pipe.
  }
}

function publishPidFile(pidFile, value) {
  const temporaryPath = `${pidFile}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(value));
  renameSync(temporaryPath, pidFile);
}

/**
 * `rah worker sync` renders Raft's drained window as text; its header states
 * the delivered cursor because RAH's Agent, unlike Raft's, has to pass that
 * cursor back to `acknowledge --through-seq`.
 */
function syncCursorAfter(stdout) {
  const matched = /cursor \d+ to (\d+) of \d+/u.exec(stdout);
  if (!matched) throw new Error(`worker sync printed no cursor: ${stdout}`);
  return Number(matched[1]);
}

function readWorkerAccessToken() {
  if (process.env.RAH_WORKER_TOKEN !== undefined) {
    throw new Error("legacy raw Worker token environment is forbidden");
  }
  const tokenPath = process.env.RAH_WORKER_SESSION_FILE;
  if (!tokenPath) throw new Error("Worker token file environment is missing");
  const token = readFileSync(tokenPath, "utf8");
  if (token.length === 0) throw new Error("Worker token file is empty");
  return token;
}

if (mode === "ignore-term" || mode === "ignore-term-with-child") {
  process.on("SIGTERM", () => {
    process.stderr.write("ignored SIGTERM\n");
  });
}

process.stdout.write(
  JSON.stringify({
    activationId: process.env.RAH_ACTIVATION_ID,
    agentHandle: agentContext?.handle,
    agentInstructions: agentContext?.agentDefinitionRevision?.instructions,
    agentRole: agentContext?.agentDefinitionRevision?.role,
    hasSupervisorConfig:
      process.env.RAH_PROCESS_SUPERVISOR_CONFIG !== undefined,
    hasSupervisorToken: process.env.RAH_PROCESS_SUPERVISOR_TOKEN !== undefined,
    contextManifestId: contextManifest?.contextManifestId,
    marker: "opaque-fake-cli-output",
    mode,
    argv: process.argv.slice(2),
  }) + "\n",
);
process.stderr.write(`fake-cli diagnostic mode=${mode}\n`);

if (mode === "trajectory") {
  writeSync(
    3,
    `${JSON.stringify({
      entry: {
        detailKind: "starting",
        kind: "status",
        activity: "working",
      },
      observedAt: "2026-08-29T01:00:00.000Z",
      producerSequence: 1,
    })}\n`,
  );
  writeSync(
    3,
    `${JSON.stringify({
      entry: {
        kind: "tool_start",
        producerFactId: "fixture-tool-1",
        toolInput: "rg -n TODO src",
        toolName: "shell",
      },
      observedAt: "2026-08-29T01:00:01.000Z",
      producerSequence: 2,
    })}\n`,
  );
  const trajectorySecret = process.env.RAH_FAKE_TRAJECTORY_SECRET;
  if (trajectorySecret) {
    writeSync(
      3,
      `${JSON.stringify({
        entry: {
          kind: "tool_start",
          producerFactId: "fixture-tool-secret",
          toolInput: `curl -H "authorization: ${trajectorySecret}" https://example.invalid`,
          toolName: "shell",
        },
        observedAt: "2026-08-29T01:00:02.000Z",
        producerSequence: 3,
      })}\n`,
    );
    writeSync(
      3,
      `${JSON.stringify({
        entry: {
          kind: "text",
          producerFactId: "fixture-text-secret",
          text: `the lease token is ${trajectorySecret}`,
        },
        observedAt: "2026-08-29T01:00:03.000Z",
        producerSequence: 4,
      })}\n`,
    );
  }
  process.exitCode = 0;
} else if (mode === "provider-session") {
  writeSync(
    3,
    `${JSON.stringify({
      protocol: "rah-provider-session/v1",
      provider: "fixture-provider/v1",
      providerSessionId: "fixture-provider-session-private",
      state: "ready",
    })}\n`,
  );
  process.exitCode = 0;
} else if (mode === "success") {
  process.exitCode = 0;
} else if (mode === "fail") {
  process.exitCode = 7;
} else if (mode === "ignore-term") {
  setInterval(() => {}, 1_000);
} else if (mode === "ignore-term-with-child") {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)",
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  child.stdout.once("data", () => {
    const pidFile = process.env.RAH_FAKE_PID_FILE;
    if (pidFile) {
      publishPidFile(pidFile, {
        childPid: child.pid,
        leaderPid: process.pid,
      });
    }
    process.stderr.write(`child-ready pid=${child.pid}\n`);
  });
  setInterval(() => {}, 1_000);
} else if (mode === "term-exits-with-stubborn-child") {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "for(const signal of ['SIGHUP','SIGINT','SIGTERM'])process.on(signal,()=>{});console.log('ready');setInterval(()=>{},1000)",
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  child.stdout.once("data", () => {
    const pidFile = process.env.RAH_FAKE_PID_FILE;
    if (pidFile) {
      publishPidFile(pidFile, {
        childPid: child.pid,
        leaderPid: process.pid,
      });
    }
    process.stderr.write(`child-ready pid=${child.pid}\n`);
  });
  setInterval(() => {}, 1_000);
} else if (mode === "noisy") {
  process.stdout.write("o".repeat(4_096));
  process.stderr.write("e".repeat(4_096));
} else if (mode === "worker-sync") {
  const baseUrl = process.env.RAH_WORKER_API_URL;
  const token = readWorkerAccessToken();
  const requiredThrough = Number(process.env.RAH_TO_SEQ);
  if (!baseUrl || !token || !Number.isInteger(requiredThrough)) {
    throw new Error("worker API environment is incomplete");
  }

  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  let afterSeq;
  let deliveredThrough = 0;
  for (let page = 0; page < 10; page += 1) {
    const response = await fetch(`${baseUrl}/v1/worker/sync`, {
      body: JSON.stringify(afterSeq === undefined ? {} : { afterSeq }),
      headers,
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`worker sync failed with HTTP ${response.status}`);
    }
    const delivery = await response.json();
    deliveredThrough = delivery.cursorAfter;
    if (deliveredThrough >= requiredThrough) break;
    if (deliveredThrough === afterSeq) {
      throw new Error("worker sync made no progress");
    }
    afterSeq = deliveredThrough;
  }
  if (deliveredThrough < requiredThrough) {
    throw new Error("worker sync did not reach the Activation range");
  }

  const acknowledgement = await fetch(`${baseUrl}/v1/worker/acknowledge`, {
    body: JSON.stringify({ throughSeq: deliveredThrough }),
    headers,
    method: "POST",
  });
  if (!acknowledgement.ok) {
    throw new Error(
      `worker acknowledgement failed with HTTP ${acknowledgement.status}`,
    );
  }
  process.stdout.write(
    JSON.stringify({ deliveredThrough, marker: "worker-sync-finished" }) + "\n",
  );
} else if (mode === "worker-self-claim") {
  // FAKE CLI FIXTURE (D1 regression): claims the delivered head message as its
  // own Task, starts and progresses it, posts one final reply in the Task
  // Thread and never submits, like the 2026-09-27 acceptance trajectory.
  const baseUrl = process.env.RAH_WORKER_API_URL;
  const token = readWorkerAccessToken();
  const requiredThrough = Number(process.env.RAH_TO_SEQ);
  if (!baseUrl || !token || !Number.isInteger(requiredThrough)) {
    throw new Error("worker API environment is incomplete");
  }
  const request = async (path, body) => {
    const response = await fetch(`${baseUrl}${path}`, {
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        `worker command ${path} failed with HTTP ${response.status}: ${JSON.stringify(result)}`,
      );
    return result;
  };
  const delivery = await request("/v1/worker/sync", {});
  if (delivery.cursorAfter < requiredThrough)
    throw new Error("worker sync did not reach the Activation range");
  const head = delivery.events.find(
    (event) =>
      event.type === "message.posted" && event.roomSeq === requiredThrough,
  );
  if (!head) throw new Error("the Activation head is not a message");
  await request("/v1/worker/acknowledge", { throughSeq: delivery.cursorAfter });
  const claimed = await request("/v1/worker/tasks/claim-message", {
    messageId: head.aggregateId,
    rationale: "[Fake CLI fixture] multi-step read-only review",
  });
  await request("/v1/worker/tasks/start", { taskId: claimed.task.taskId });
  await request("/v1/worker/tasks/progress", {
    progress: "[Fake CLI fixture] read the files",
    taskId: claimed.task.taskId,
  });
  await request("/v1/worker/messages/post", {
    body: "[Fake CLI fixture] review summary",
    final: true,
    threadId: claimed.task.threadId,
  });
  process.stdout.write(
    JSON.stringify({ marker: "worker-self-claim-finished" }) + "\n",
  );
} else if (mode === "worker-cli-sync") {
  if (process.env.RAH_AGENT_TOOL_BIN !== undefined) {
    throw new Error("internal Worker tool directory hint leaked to Runtime");
  }
  const requiredThrough = Number(process.env.RAH_TO_SEQ);
  // Raft prints the drained window as text and RAH does the same, so the fake
  // Agent reads the cursor off the rendered line exactly as a real one must.
  const deliveredThrough = syncCursorAfter(
    execFileSync("rah", ["worker", "sync"], { encoding: "utf8" }),
  );
  if (
    !Number.isInteger(requiredThrough) ||
    !Number.isInteger(deliveredThrough) ||
    deliveredThrough < requiredThrough
  ) {
    throw new Error("rah Worker CLI did not deliver the Activation range");
  }
  execFileSync(
    "rah",
    ["worker", "acknowledge", "--through-seq", String(deliveredThrough)],
    { encoding: "utf8" },
  );
  process.stdout.write(
    JSON.stringify({
      deliveredThrough,
      marker: "worker-cli-sync-finished",
    }) + "\n",
  );
} else if (
  mode === "worker-task" ||
  mode === "worker-task-resume" ||
  mode === "worker-task-input" ||
  mode === "worker-task-input-resume"
) {
  const baseUrl = process.env.RAH_WORKER_API_URL;
  const token = readWorkerAccessToken();
  const requiredFrom = Number(process.env.RAH_FROM_SEQ);
  const requiredThrough = Number(process.env.RAH_TO_SEQ);
  if (
    !baseUrl ||
    !token ||
    !Number.isInteger(requiredFrom) ||
    !Number.isInteger(requiredThrough) ||
    requiredFrom > requiredThrough
  ) {
    throw new Error("worker Task API environment is incomplete");
  }

  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const request = async (path, body) => {
    const response = await fetch(`${baseUrl}${path}`, {
      body: JSON.stringify(body),
      headers,
      method: "POST",
    });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(
        `worker Task command ${path} failed with HTTP ${response.status}: ${JSON.stringify(result)}`,
      );
      error.status = response.status;
      error.code = result?.error?.code;
      throw error;
    }
    return result;
  };

  const preSyncBarrierPath = process.env.RAH_FAKE_PRE_SYNC_BARRIER_PATH?.trim();
  if (preSyncBarrierPath && !existsSync(preSyncBarrierPath)) {
    writeFileSync(
      `${preSyncBarrierPath}.started`,
      `${process.env.RAH_ACTIVATION_ID ?? "unknown"}\n`,
    );
    while (!existsSync(preSyncBarrierPath)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  let afterSeq;
  let delivery;
  const events = [];
  for (let page = 0; page < 10; page += 1) {
    delivery = await request(
      "/v1/worker/sync",
      afterSeq === undefined ? {} : { afterSeq },
    );
    events.push(...delivery.events);
    if (delivery.cursorAfter >= requiredThrough) break;
    if (delivery.cursorAfter === afterSeq) {
      throw new Error("worker Task sync made no progress");
    }
    afterSeq = delivery.cursorAfter;
  }
  if (!delivery || delivery.cursorAfter < requiredThrough) {
    throw new Error("worker Task sync did not reach the Activation range");
  }
  const firstRun = events.find(
    (event) =>
      event.type === "agent.first_run_requested" &&
      event.payload.participantId === agentContext?.participantId,
  );
  if (firstRun) {
    publishTrajectory({
      kind: "status",
      activity: "working",
      detailKind: "starting",
    });
    await new Promise((resolve) =>
      setTimeout(resolve, Number(process.env.RAH_FAKE_FIRST_RUN_DELAY_MS ?? 0)),
    );
    if (firstRun.payload.greetingEnabled) {
      const sendGreeting = (body) =>
        JSON.parse(
          execFileSync(
            process.env.RAH_WORKER_CLI,
            [
              "worker",
              "message-post",
              "--json",
              "--top-level",
              "--idempotency-key",
              firstRun.payload.messageKey,
            ],
            { encoding: "utf8", input: body },
          ),
        );
      const sent = sendGreeting(
        "[Fake CLI fixture] Hello from a newly created Agent.",
      );
      if (!sent.event)
        throw new Error("First-run fixture greeting was not committed");
      const replay = sendGreeting(
        "[Fake CLI fixture] A retry must not publish this alternative greeting.",
      );
      if (!replay.deduplicated || replay.event.eventId !== sent.event.eventId)
        throw new Error("First-run greeting retry was duplicated");
    }
    await request("/v1/worker/acknowledge", {
      throughSeq: delivery.cursorAfter,
    });
    process.stdout.write("first-run fixture completed\n");
    process.exit(0);
  }
  if (
    process.env.RAH_FAKE_MESSAGE_TOOLS === "1" &&
    events.some(
      (event) =>
        event.type === "message.posted" &&
        event.payload.body?.includes("[WORKER-TOOLS]"),
    )
  ) {
    const cli = (args) =>
      execFileSync(process.env.RAH_WORKER_CLI, ["worker", ...args], {
        encoding: "utf8",
      });
    // Raft's `message search` prints text, so the probe reads the rendered
    // `<result ref="msg:ID">` line rather than a JSON field.
    const found = cli([
      "message-search",
      "--query",
      "[WORKER-TOOLS]",
      "--limit",
      "1",
    ]);
    const refs = [...found.matchAll(/^<result ref="msg:([^"]+)">$/gmu)];
    if (refs.length !== 1)
      throw new Error("Worker search did not find the explicit probe message");
    const messageId = refs[0][1];
    // Raft's minimal toggle: the message, the emoji, and nothing else.
    // Raft's `message react` acknowledges in text, naming the emoji, the
    // direction and the message.
    const reacted = execFileSync(
      process.env.RAH_WORKER_CLI,
      ["worker", "message-react", "--message-id", messageId, "--emoji", "👍"],
      { encoding: "utf8" },
    );
    if (reacted.trim() !== `Reaction 👍 added to message ${messageId}.`)
      throw new Error(`Worker reaction did not persist: ${reacted}`);
  }
  const requiredContextEventTypes = (
    process.env.RAH_FAKE_REQUIRED_CONTEXT_EVENT_TYPES ?? ""
  )
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  for (const requiredType of requiredContextEventTypes) {
    if (!events.some((event) => event.type === requiredType)) {
      throw new Error(`worker Task context omitted ${requiredType}`);
    }
  }
  const activationEvents = events.filter(
    (event) =>
      event.roomSeq >= requiredFrom && event.roomSeq <= requiredThrough,
  );
  // The read family renders text upstream, so the fake Agent reads text. Only
  // the commands Raft itself answers in JSON are parsed as JSON.
  const readText =
    process.env.RAH_FAKE_READ_TOOLS === "1"
      ? (args) =>
          execFileSync(process.env.RAH_WORKER_CLI, ["worker", ...args], {
            encoding: "utf8",
          })
      : undefined;
  const readTool =
    readText === undefined ? undefined : (args) => JSON.parse(readText(args));
  if (readText) {
    const members = readText(["room-members"]);
    const server = readText(["server-info"]);
    // `raft profile show` prints `formatProfile`; the self view is the handle
    // line's `(you)` marker, not a JSON field.
    const profile = readText(["profile-show"]);
    if (
      !members.includes(`id=${process.env.RAH_PARTICIPANT_ID}`) ||
      !server.includes(`id=${process.env.RAH_ROOM_ID}`) ||
      !profile.includes("(you)") ||
      !profile.includes(`- ID: ${process.env.RAH_PARTICIPANT_ID}`)
    )
      throw new Error("Worker identity reads did not match the execution");
  }

  // Raft's busy-hold recovery, driven through the real Worker CLI: a second
  // Human message lands at the same target while this Agent is still composing
  // its result, the send is freshness-held, and the saved draft is then sent
  // unchanged by target alone. The original result must survive.
  if (process.env.RAH_FAKE_BUSY_HOLD_RECOVERY === "1") {
    const presentedLog = process.env.RAH_FAKE_PRESENTED_CONTEXT_LOG;
    const trigger = activationEvents.find(
      (event) =>
        event.type === "message.posted" &&
        typeof event.payload?.body === "string" &&
        event.payload.body.includes("[BUSY-HOLD]"),
    );
    if (trigger) {
      const workerCli = process.env.RAH_WORKER_CLI;
      const barrier = process.env.RAH_FAKE_BUSY_HOLD_BARRIER;
      if (!workerCli || !barrier) {
        throw new Error(
          "busy-hold fixture requires RAH_WORKER_CLI and RAH_FAKE_BUSY_HOLD_BARRIER",
        );
      }
      const originalResult = process.env.RAH_FAKE_BUSY_HOLD_RESULT ?? "";
      const followUpAnswer = process.env.RAH_FAKE_BUSY_HOLD_FOLLOW_UP ?? "";
      // The Agent is "working": the test posts the interrupting message and
      // then opens this barrier, so the race is deterministic.
      writeFileSync(
        `${barrier}.started`,
        `${process.env.RAH_ACTIVATION_ID ?? "unknown"}\n`,
      );
      while (!existsSync(barrier)) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const transcript = [];
      const cli = (args, input) => {
        const result = spawnSync(workerCli, ["worker", ...args], {
          encoding: "utf8",
          input: input ?? "",
        });
        transcript.push({
          args,
          status: result.status,
          stdout: result.stdout,
          stderr: result.stderr,
        });
        // The fixture's own diagnostics; the daemon never reads this file.
        writeFileSync(`${barrier}.log`, JSON.stringify(transcript, null, 2));
        return result;
      };
      const held = cli(["message-post"], `${originalResult}\n`);
      if (held.status === 0) {
        throw new Error("a freshness-held send must not exit successfully");
      }
      // Raft writes the human-readable send output to stdout. This fixture
      // reads it exactly as a model does: no `--json`, no stderr capture.
      if (!held.stdout.includes("SEND_HELD_AS_DRAFT")) {
        throw new Error(`expected a freshness hold, got ${held.stdout}`);
      }
      const recovery = /--send-draft --target '([^']+)'/u.exec(held.stdout);
      if (recovery === null) {
        throw new Error("the held output must teach the draft recovery path");
      }
      const target = recovery[1];
      const counted = /of (\d+) newer message/u.exec(held.stdout);
      // Recovery needs only the target: no receipt, cursor, key or draft id.
      const recovered = cli([
        "message-post",
        "--send-draft",
        "--target",
        target,
      ]);
      if (recovered.status !== 0) {
        throw new Error(`draft recovery failed: ${recovered.stderr}`);
      }
      const followUp = cli(
        ["message-post", "--target", target],
        `${followUpAnswer}\n`,
      );
      if (followUp.status !== 0) {
        throw new Error(`follow-up send failed: ${followUp.stderr}`);
      }
      await request("/v1/worker/acknowledge", {
        throughSeq: delivery.cursorAfter,
      });
      process.stdout.write(
        JSON.stringify({
          marker: "worker-busy-hold-recovered",
          recoveryTarget: target,
          newMessageCount: counted === null ? 0 : Number(counted[1]),
        }) + "\n",
      );
      process.exit(0);
    }
    // The follow-up Activation for the very message the hold already showed
    // this Agent. It syncs through the real Worker CLI and records exactly what
    // the delivery states, without re-deriving anything.
    if (presentedLog) {
      const sync = spawnSync(process.env.RAH_WORKER_CLI, ["worker", "sync"], {
        encoding: "utf8",
      });
      if (sync.status !== 0) {
        throw new Error(`presented-context sync failed: ${sync.stderr}`);
      }
      writeFileSync(
        presentedLog,
        JSON.stringify(
          {
            activationId: process.env.RAH_ACTIVATION_ID ?? null,
            fromSeq: Number(process.env.RAH_FROM_SEQ),
            toSeq: Number(process.env.RAH_TO_SEQ),
            // Recorded as the bytes the Agent actually read. The stderr defect
            // this chain was written for is only visible when the fixture
            // observes the rendered stream rather than a re-parsed payload.
            syncText: sync.stdout,
          },
          null,
          2,
        ),
      );
      await request("/v1/worker/acknowledge", {
        throughSeq: delivery.cursorAfter,
      });
      process.stdout.write(
        JSON.stringify({ marker: "worker-presented-context-observed" }) + "\n",
      );
      process.exit(0);
    }
  }

  if (process.env.RAH_FAKE_PARENT_RESUME === "1" && readText) {
    const resume = activationEvents.find(
      (event) =>
        event.type === "message.posted" &&
        /\[RESUME PARENT [^\]]+\]/u.test(event.payload?.body ?? ""),
    );
    if (resume) {
      const taskId = /\[RESUME PARENT ([^\]]+)\]/u.exec(resume.payload.body)[1];
      // Raft-shaped: a Task command carries no cursor and no key.
      // Task mutations acknowledge in text, as Raft's `task update` does.
      const result = readText(["task-unblock", "--task-id", taskId]);
      if (!/^#\d+ moved to todo\.$/mu.test(result))
        throw new Error(`unblock did not leave pending work: ${result}`);
      let denied = false;
      try {
        readText(["task-claim", "--task-id", taskId]);
      } catch (error) {
        denied = String(error.stderr).includes(
          "not linked in this Activation range",
        );
      }
      if (!denied)
        throw new Error("unblock improperly expanded this Run's scope");
      readTool(["acknowledge", "--through-seq", String(delivery.cursorAfter)]);
      process.stdout.write(
        JSON.stringify({
          marker: "parent-unblocked-awaiting-next-activation",
          taskId,
        }) + "\n",
      );
      process.exit(0);
    }
  }

  // There is no auditor role: a Human @mentions an ordinary Room Agent and
  // asks it to audit a Task. The Agent reads the owner's recorded trajectory
  // through the Worker API and replies once with the tool evidence it found.
  if (process.env.RAH_FAKE_AUDIT_ON_MENTION === "1") {
    const selfParticipantId = process.env.RAH_PARTICIPANT_ID;
    const auditRequest = activationEvents.find(
      (event) =>
        event.type === "message.posted" &&
        event.payload?.threadId === undefined &&
        typeof event.payload?.body === "string" &&
        /\[AUDIT [^\]]+\]/u.test(event.payload.body) &&
        (event.payload.recipients ?? []).some(
          (recipient) =>
            recipient.participantId === selfParticipantId &&
            recipient.reason === "mention",
        ),
    );
    if (auditRequest) {
      const auditedTaskId = /\[AUDIT ([^\]]+)\]/u.exec(
        auditRequest.payload.body,
      )[1];
      let sourceMessageId;
      let auditedThreadId;
      if (readText) {
        const card = readText(["task-get", "--task-id", auditedTaskId]);
        sourceMessageId = /^Source message: (\S+)$/mu.exec(card)?.[1];
        auditedThreadId = /^Thread: (\S+)$/mu.exec(card)?.[1];
        if (sourceMessageId === undefined)
          throw new Error(`task-get printed no source message: ${card}`);
        const history = readText(["task-history", "--task-id", auditedTaskId]);
        const board = readText(["task-list"]);
        const resolved = readText([
          "message-resolve",
          "--message-id",
          sourceMessageId,
        ]);
        const around = readText(["message-read", "--around", sourceMessageId]);
        readText(["task-submission", "--task-id", auditedTaskId]);
        if (
          !history.includes("type=task.created") ||
          !board.includes(`id=${auditedTaskId}`) ||
          !resolved.includes(`msg=${sourceMessageId}`) ||
          !around.includes(`msg=${sourceMessageId}`)
        )
          throw new Error(
            "Worker source reads did not establish the audited Task",
          );
      }
      const trajectory = await request("/v1/worker/tasks/trajectory", {
        limit: 50,
        taskId: auditedTaskId,
      });
      const toolNames = trajectory.entries
        .filter((record) => record.entry.kind === "tool_start")
        .map((record) => record.entry.toolName);
      const activationId = process.env.RAH_ACTIVATION_ID;
      if (!activationId)
        throw new Error("audit reply requires RAH_ACTIVATION_ID");
      const replied = await request("/v1/worker/messages/post", {
        basedOnRoomSeq: delivery.cursorAfter,
        ...(auditedThreadId === undefined ? {} : { threadId: auditedThreadId }),
        body: `Audit of ${auditedTaskId}: ${String(trajectory.entries.length)} trajectory entries; tools: ${toolNames.join(", ")}${readText ? "; read-tools: canonical history, task board, member handles, exact source" : ""}`,
        idempotencyKey: `fake:${activationId}:audit-reply`,
      });
      await request("/v1/worker/acknowledge", {
        throughSeq: delivery.cursorAfter,
      });
      process.stdout.write(
        JSON.stringify({
          marker: "worker-audit-finished",
          state: replied.state,
          taskId: auditedTaskId,
        }) + "\n",
      );
      process.exit(0);
    }
    await request("/v1/worker/acknowledge", {
      throughSeq: delivery.cursorAfter,
    });
    process.stdout.write(
      JSON.stringify({ marker: "worker-audit-idle" }) + "\n",
    );
    process.exit(0);
  }
  // Explicit isolated browser probe: real child -> fd3 -> Host -> Kernel -> UI.
  // This is deterministic test telemetry, never presented as a real LLM run.
  if (
    process.env.RAH_FAKE_PRESENCE_PROBE === "1" &&
    activationEvents.some(
      (event) =>
        event.type === "message.posted" &&
        event.payload?.body === "[presence-probe]",
    )
  ) {
    for (const entry of [
      { kind: "status", activity: "thinking", detailKind: "thinking_started" },
      {
        kind: "tool_start",
        toolName: "fixture read",
        toolInput: "isolated test file",
      },
      { kind: "status", activity: "error", detailKind: "runtime_error" },
      { kind: "status", activity: "online", detailKind: "none" },
    ]) {
      publishTrajectory(entry);
      await new Promise((resolve) => setTimeout(resolve, 20000));
    }
  }
  publishTrajectory({
    activity: "working",
    detail: "正在检查 Room 消息",
    detailKind: "checking_messages",
    kind: "status",
    producerFactId: "fixture:messages:checked",
  });
  let autoClaimedTask;
  const autoTaskMarker = process.env.RAH_FAKE_AUTO_TASK_MARKER?.trim();
  const autoTaskMessage = !autoTaskMarker
    ? undefined
    : activationEvents.find(
        (event) =>
          event.type === "message.posted" &&
          typeof event.payload?.body === "string" &&
          event.payload.body.includes(autoTaskMarker),
      );
  if (autoTaskMessage) {
    const activationId = process.env.RAH_ACTIVATION_ID;
    if (!activationId) {
      throw new Error("automatic Task claim requires RAH_ACTIVATION_ID");
    }
    try {
      autoClaimedTask = await request("/v1/worker/tasks/claim-message", {
        messageId: autoTaskMessage.aggregateId,
        rationale:
          "Fixture marker denotes persistent multi-step work with progress and review",
      });
    } catch (error) {
      if (error?.status !== 409) throw error;
      await request("/v1/worker/acknowledge", {
        throughSeq: delivery.cursorAfter,
      });
      process.stdout.write(
        JSON.stringify({
          marker: "worker-task-claim-lost",
          messageId: autoTaskMessage.aggregateId,
        }) + "\n",
      );
      process.exit(0);
    }
  }
  // Deterministic delegation fixture: after auto-claiming the marker message
  // the lead splits it into one unassigned subtask per helper, then wakes each
  // helper personally with one @mention note before parking its own parent
  // Task. Only the Room lead runs this branch (RAH_FAKE_SPLIT_HELPERS).
  const splitHelpers = (process.env.RAH_FAKE_SPLIT_HELPERS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (autoClaimedTask && splitHelpers.length > 0) {
    const activationId = process.env.RAH_ACTIVATION_ID;
    if (!activationId) {
      throw new Error("Task split requires RAH_ACTIVATION_ID");
    }
    const splitTitles = (process.env.RAH_FAKE_SPLIT_TITLES ?? "")
      .split(",")
      .map((value) => value.trim());
    const parentTaskId = autoClaimedTask.task.taskId;
    if (readText && !readText(["task-list"]).includes(`id=${parentTaskId}`))
      throw new Error("Task board omitted the parent before splitting");
    // message-post is an Activation-head command: the Kernel requires the
    // delivered head, not the Agent's own advancing cursor. task-create
    // instead follows the Worker prompt and chains each non-deduplicated
    // response event.roomSeq into the next call.
    const activationHead = delivery.cursorAfter;
    await request("/v1/worker/tasks/start", { taskId: parentTaskId });
    const subtasks = [];
    for (const [index, helper] of splitHelpers.entries()) {
      const label = String.fromCodePoint(65 + index);
      const suffix = splitTitles[index] ?? `part ${label}`;
      const created = await request("/v1/worker/tasks/create", {
        title: `Subtask ${label} (@${helper}): ${suffix}`,
      });
      subtasks.push({
        label,
        roomSeq: created.event.roomSeq,
        taskId: created.task.taskId,
      });
    }
    const note = await request("/v1/worker/messages/post", {
      basedOnRoomSeq: activationHead,
      body: splitHelpers
        .map(
          (helper, index) =>
            `@${helper} please take Subtask ${String.fromCodePoint(65 + index)}`,
        )
        .join(", "),
      idempotencyKey: `fake:${activationId}:split-note`,
    });
    // The parent stays owned by the lead and unfinished, so it must reach a
    // canonical waiting state: an acknowledged Activation may not leave an
    // owned Task executing.
    const blocked = await request("/v1/worker/tasks/block", {
      reason: "Waiting for the delegated subtasks",
      taskId: parentTaskId,
    });
    await request("/v1/worker/acknowledge", {
      throughSeq: delivery.cursorAfter,
    });
    process.stdout.write(
      JSON.stringify({
        marker: "worker-task-split-finished",
        noteRoomSeq: note.event?.roomSeq,
        parentState: blocked.task.state,
        parentTaskId,
        subtaskIds: subtasks.map(({ taskId }) => taskId),
      }) + "\n",
    );
    process.exit(0);
  }
  const latestRootMessage = findLatestRootMessage(activationEvents);
  const hasTaskBusinessEvent = activationEvents.some((event) =>
    [
      "task.created",
      "task.assigned",
      "task.unassigned",
      "task.reassigned",
      "task.reopened",
      "task.unblocked",
      "task.released",
      "task.submitted",
      "review.submitted",
      "input.resolved",
    ].includes(event.type),
  );
  const roomReply =
    autoClaimedTask || hasTaskBusinessEvent
      ? undefined
      : process.env.RAH_FAKE_ROOM_REPLY_MODE === "contextual-demo"
        ? contextualDemoRoomReply(latestRootMessage)
        : process.env.RAH_FAKE_ROOM_REPLY_MODE === "turn-taking-counter"
          ? turnTakingCounterRoomReply(latestRootMessage)
          : typeof latestRootMessage?.payload?.activationId === "string"
            ? undefined
            : process.env.RAH_FAKE_ROOM_REPLY?.trim();
  let roomReplyState;
  if (roomReply) {
    publishTrajectory({
      kind: "thinking",
      producerFactId: "fixture:reply:thinking",
      text: "正在整理对 Room 消息的回复",
    });
    const activationId = process.env.RAH_ACTIVATION_ID;
    if (!activationId) {
      throw new Error("worker Room reply requires RAH_ACTIVATION_ID");
    }
    const replied = await request("/v1/worker/messages/post", {
      basedOnRoomSeq: delivery.cursorAfter,
      body: roomReply,
      idempotencyKey: `fake:${activationId}:room-reply`,
    });
    roomReplyState = replied.state === "held" ? "held" : "posted";
    if (roomReplyState === "held") {
      process.stdout.write(
        JSON.stringify({
          heldDraftId: replied.heldDraftId,
          marker: "worker-room-reply-held",
          newerMessageCount: replied.newMessageCount,
        }) + "\n",
      );
    } else {
      process.stdout.write(
        JSON.stringify({
          activationCount: replied.activationIds.length,
          marker: "worker-room-reply-posted",
          roomSeq: replied.event.roomSeq,
        }) + "\n",
      );
      publishTrajectory({
        kind: "text",
        producerFactId: "fixture:reply:text",
        text: roomReply,
      });
      const reminderTitle = process.env.RAH_FAKE_REMINDER_TITLE?.trim();
      if (reminderTitle && latestRootMessage) {
        const reminder = await request("/v1/worker/reminders/schedule", {
          basedOnRoomSeq: delivery.cursorAfter,
          delaySeconds: 86_400,
          idempotencyKey: `fake:${activationId}:reminder`,
          messageId: latestRootMessage.aggregateId,
          title: reminderTitle,
        });
        process.stdout.write(
          JSON.stringify({
            marker: "worker-reminder-scheduled",
            reminderId: reminder.reminder.reminderId,
          }) + "\n",
        );
      }
    }
  }
  // One Activation may coalesce several unassigned `task.created` events. When
  // the fixture runs with attribution enabled, a subtask titled `@handle` is
  // reserved for that helper: every Agent then claims exactly one distinct
  // subtask instead of racing for the first created Task.
  const createdEvents = activationEvents.filter(
    (event) => event.type === "task.created",
  );
  const taskCreated =
    process.env.RAH_FAKE_TASK_ATTRIBUTION === "1"
      ? attributedTaskCreated(createdEvents, agentContext?.handle)
      : createdEvents[0];
  const taskReassigned = activationEvents.find(
    (event) => event.type === "task.reassigned",
  );
  const taskUnassigned = activationEvents.find(
    (event) => event.type === "task.unassigned",
  );
  const taskUnblocked = activationEvents.find(
    (event) => event.type === "task.unblocked",
  );
  const taskReopened = activationEvents.find(
    (event) => event.type === "task.reopened",
  );
  const taskSubmitted = activationEvents.find(
    (event) => event.type === "task.submitted",
  );
  const reviewSubmitted = activationEvents.find(
    (event) => event.type === "review.submitted",
  );
  const inputResolved = activationEvents.find(
    (event) => event.type === "input.resolved",
  );
  const isInputMode =
    mode === "worker-task-input" || mode === "worker-task-input-resume";
  const taskId =
    autoClaimedTask?.task?.taskId ??
    taskReassigned?.aggregateId ??
    taskUnassigned?.aggregateId ??
    taskReopened?.aggregateId ??
    taskUnblocked?.aggregateId ??
    taskCreated?.aggregateId ??
    taskSubmitted?.aggregateId ??
    reviewSubmitted?.payload?.taskId ??
    inputResolved?.payload?.taskId;
  if (!taskId && roomReply) {
    await request("/v1/worker/acknowledge", {
      throughSeq: delivery.cursorAfter,
    });
    process.stdout.write(
      JSON.stringify({
        deliveredThrough: delivery.cursorAfter,
        marker:
          roomReplyState === "held"
            ? "worker-room-reply-held-finished"
            : "worker-room-reply-finished",
      }) + "\n",
    );
    process.exit(0);
  }
  if (!taskId) {
    await request("/v1/worker/acknowledge", {
      throughSeq: delivery.cursorAfter,
    });
    process.stdout.write(
      JSON.stringify({
        deliveredThrough: delivery.cursorAfter,
        marker: "worker-attention-acknowledged-without-reply",
      }) + "\n",
    );
    process.exit(0);
  }
  if (
    isInputMode &&
    inputResolved &&
    inputResolved.payload?.answer !== "Yes, remain loopback-only"
  ) {
    throw new Error("resolved human input was not delivered canonically");
  }
  const participantId = process.env.RAH_PARTICIPANT_ID;
  if (!participantId) {
    throw new Error("Worker participant identity is missing");
  }
  const commandActivationId = process.env.RAH_ACTIVATION_ID;
  if (!commandActivationId) {
    throw new Error("Worker activation identity is missing");
  }
  let basedOnRoomSeq = autoClaimedTask?.event?.roomSeq ?? delivery.cursorAfter;
  // A reopened Task is a new round of owner work: its commands must not
  // deduplicate against the round that was rejected, even when the same
  // Activation is retried with the reopen inside its range.
  const reworkPhase =
    taskReopened === undefined
      ? undefined
      : `rework:${String(taskReopened.roomSeq)}`;
  const commandId = (operation) =>
    `fake:${createHash("sha256")
      .update(
        `${participantId}\0${taskId}\0${commandActivationId}\0${
          reworkPhase === undefined ? operation : `${reworkPhase}:${operation}`
        }`,
      )
      .digest("hex")}`;
  const canonical = await request("/v1/worker/tasks/get", { taskId });
  const inputStatus = isInputMode
    ? await request("/v1/worker/tasks/input-status", { taskId })
    : { inputRequest: null };

  const isCollaborator =
    canonical.task.collaboratorIds?.includes(participantId);
  const isReviewer = canonical.task.reviewerIds?.includes(participantId);
  const collaboratorWorkRequired =
    taskCreated &&
    canonical.task.assigneeId !== participantId &&
    isCollaborator;
  const reviewWorkRequired = taskSubmitted && isReviewer;
  if (collaboratorWorkRequired || reviewWorkRequired) {
    if (!roomReply) {
      if (collaboratorWorkRequired) {
        await request("/v1/worker/messages/post", {
          basedOnRoomSeq: delivery.cursorAfter,
          body: "协作证据：Fake Worker 已完成负责人请求的独立检查。",
          idempotencyKey: commandId("collaboration"),
        });
      }
      if (reviewWorkRequired) {
        const frozen = await request("/v1/worker/tasks/submission", { taskId });
        const requestChanges =
          process.env.RAH_FAKE_REVIEW_FIRST_SUBMISSION ===
            "changes_requested" && frozen.submission?.submissionNumber === 1;
        await request("/v1/worker/tasks/review", {
          disposition: requestChanges ? "changes_requested" : "approved",
          summary: requestChanges
            ? "要求修改：首个冻结版本缺少独立验收证据。"
            : "审阅通过：提交证据与 Task 范围一致。",
          taskId,
        });
      }
    }
    await request("/v1/worker/acknowledge", {
      throughSeq: delivery.cursorAfter,
    });
    process.stdout.write(
      JSON.stringify({
        collaboratorWorkRequired: Boolean(collaboratorWorkRequired),
        marker: "worker-task-secondary-roles-finished",
        reviewWorkRequired: Boolean(reviewWorkRequired),
        taskId,
      }) + "\n",
    );
  } else if (
    canonical.task.assigneeId &&
    canonical.task.assigneeId !== participantId
  ) {
    await request("/v1/worker/acknowledge", {
      throughSeq: delivery.cursorAfter,
    });
    process.stdout.write(
      JSON.stringify({ marker: "worker-task-owned-by-peer", taskId }) + "\n",
    );
  } else if (inputStatus.inputRequest && !inputResolved) {
    await request("/v1/worker/acknowledge", {
      throughSeq: delivery.cursorAfter,
    });
    process.stdout.write(
      JSON.stringify({
        inputRequestId: inputStatus.inputRequest.inputRequestId,
        marker: "worker-task-input-already-paused",
        state: inputStatus.inputRequest.state,
        taskId,
      }) + "\n",
    );
  } else if (
    canonical.task.state === "submitted" ||
    canonical.task.state === "completed"
  ) {
    await request("/v1/worker/acknowledge", {
      throughSeq: delivery.cursorAfter,
    });
    process.stdout.write(
      JSON.stringify({
        marker: "worker-task-already-terminal",
        state: canonical.task.state,
        taskId,
      }) + "\n",
    );
  } else {
    const claimExpired =
      (canonical.task.state === "claimed" ||
        canonical.task.state === "in_progress") &&
      Date.parse(canonical.task.claimUntil) <= Date.now();
    const recoveryKey = process.env.RAH_RUN_ATTEMPT_ID;
    if (claimExpired && !recoveryKey) {
      throw new Error("expired Task recovery requires RAH_RUN_ATTEMPT_ID");
    }
    const inputPhase = isInputMode
      ? inputResolved
        ? "after-input"
        : "before-input"
      : undefined;
    const claimCommandId = claimExpired
      ? commandId(`reclaim:${recoveryKey}`)
      : commandId(inputPhase ? `claim:${inputPhase}` : "claim");
    const startCommandId = claimExpired
      ? commandId(`restart:${recoveryKey}`)
      : commandId(inputPhase ? `start:${inputPhase}` : "start");
    if (!autoClaimedTask) {
      let claimed;
      try {
        claimed = await request("/v1/worker/tasks/claim", {
          taskId,
          // An expired lease is the one case the server cannot tell from a
          // retry, so that recovery still presents an explicit key.
          ...(claimExpired ? { idempotencyKey: claimCommandId } : {}),
        });
      } catch (error) {
        // Another Agent won the same unassigned Task: a lost claim is a
        // concurrency lock, never a licence to duplicate the work.
        if (error?.status !== 409 || error?.code !== "conflict") throw error;
        await request("/v1/worker/acknowledge", {
          throughSeq: delivery.cursorAfter,
        });
        process.stdout.write(
          JSON.stringify({ marker: "worker-task-claim-lost", taskId }) + "\n",
        );
        process.exit(0);
      }
      if (!claimed.deduplicated) {
        basedOnRoomSeq = Math.max(basedOnRoomSeq, claimed.event.roomSeq);
      }
    }
    // Raft addresses a Task as a Human reads it: `--target "#channel" --number
    // N`. One command of the deterministic chain uses that form end to end.
    const rooms = await request("/v1/worker/rooms/list", {});
    const taskChannel = rooms.rooms.find(
      (entry) => entry.room.roomId === canonical.task.roomId,
    )?.channel;
    if (!taskChannel) {
      throw new Error("the canonical Task Room is not a visible target");
    }
    const taskAddress = `${taskChannel} #${String(canonical.task.taskNumber)}`;
    const started = await request("/v1/worker/tasks/start", {
      channel: taskChannel,
      taskNumber: canonical.task.taskNumber,
      ...(claimExpired ? { idempotencyKey: startCommandId } : {}),
    });
    if (started.task.taskId !== taskId) {
      throw new Error(`${taskAddress} resolved to a different canonical Task`);
    }
    if (!started.deduplicated) {
      basedOnRoomSeq = Math.max(basedOnRoomSeq, started.event.roomSeq);
    }
    const holdMarker = process.env.RAH_FAKE_TASK_HOLD_MARKER?.trim();
    const holdMs = Number(process.env.RAH_FAKE_TASK_HOLD_MS ?? "0");
    if (
      holdMarker &&
      canonical.task.title.includes(holdMarker) &&
      Number.isInteger(holdMs) &&
      holdMs > 0
    ) {
      publishTrajectory({
        activity: "working",
        detail: `Holding active Task for ${String(holdMs)}ms`,
        detailKind: "fixture_task_hold",
        kind: "status",
      });
      await new Promise((resolve) => setTimeout(resolve, holdMs));
    }

    const resumeMarkerPath = process.env.RAH_FAKE_RESUME_MARKER;
    if (isInputMode && !inputResolved) {
      const requested = await request("/v1/worker/tasks/request-input", {
        question: "Should the daemon remain loopback-only for this phase?",
        taskId,
      });
      const inputResumeMarker = process.env.RAH_FAKE_RESUME_MARKER;
      if (
        mode === "worker-task-input-resume" &&
        inputResumeMarker &&
        !existsSync(inputResumeMarker)
      ) {
        writeFileSync(inputResumeMarker, "retry after InputRequest commit\n");
        process.stderr.write("simulated failure after input.requested\n");
        process.exitCode = 7;
      } else {
        await request("/v1/worker/acknowledge", {
          throughSeq: delivery.cursorAfter,
        });
        process.stdout.write(
          JSON.stringify({
            inputRequestId: requested.inputRequest.inputRequestId,
            marker: "worker-task-waiting-input",
            state: requested.task.state,
            taskId,
          }) + "\n",
        );
      }
    } else if (
      mode === "worker-task-resume" &&
      resumeMarkerPath &&
      !existsSync(resumeMarkerPath)
    ) {
      writeFileSync(resumeMarkerPath, "resume on the next RunAttempt\n");
      process.stderr.write("simulated failure after task.started\n");
      process.exitCode = 7;
    } else {
      // Gated so the owner's Task leaves one readable tool call behind for a
      // Room Agent asked to audit it. Other suites keep their exact trajectory.
      if (process.env.RAH_FAKE_TASK_TOOL_TRAJECTORY === "1") {
        publishTrajectory({
          kind: "tool_start",
          producerFactId: `fixture:task:${taskId}:tool`,
          toolInput: '{"command":"echo subtask"}',
          toolName: "bash",
        });
      }
      const progressed = await request("/v1/worker/tasks/progress", {
        progress: "Fake Worker verified the daemon Task command path",
        taskId,
      });
      if (!progressed.deduplicated) {
        basedOnRoomSeq = Math.max(basedOnRoomSeq, progressed.event.roomSeq);
      }
      if (process.env.RAH_FAKE_TASK_ARTIFACT === "1") {
        const artifactPath = join(
          process.cwd(),
          `fixture-task-artifact-${taskId}.txt`,
        );
        writeFileSync(
          artifactPath,
          `Canonical fake Task artifact for ${taskId}\n`,
        );
        const workerCli = process.env.RAH_WORKER_CLI;
        if (!workerCli) {
          throw new Error("Task artifact fixture requires RAH_WORKER_CLI");
        }
        execFileSync(
          workerCli,
          [
            "worker",
            "artifact-publish",
            "--task-id",
            taskId,
            "--path",
            artifactPath,
            "--filename",
            "browser-gate-task-evidence.txt",
            "--mime-type",
            "text/plain",
            "--idempotency-key",
            commandId(`artifact:${process.env.RAH_ACTIVATION_ID ?? "run"}`),
          ],
          { encoding: "utf8" },
        );
      }
      const submitted = await request("/v1/worker/tasks/submit", {
        summary: "Fake Worker completed the durable Task protocol",
        taskId,
      });
      await request("/v1/worker/acknowledge", {
        throughSeq: delivery.cursorAfter,
      });
      process.stdout.write(
        JSON.stringify({
          marker: "worker-task-finished",
          startedByAddress: taskAddress,
          state: submitted.task.state,
          taskId,
        }) + "\n",
      );
      publishTrajectory({
        activity: "online",
        detail: "工作轮次已完成",
        detailKind: "stopped",
        kind: "status",
        producerFactId: "fixture:task:completed",
      });
    }
  }
} else {
  process.stderr.write(`unknown mode ${mode}\n`);
  process.exitCode = 64;
}

/**
 * Pick the one `task.created` event this Agent may claim. A title carrying
 * `@handle` is reserved for that handle; untitled attribution stays open to
 * anyone, and a Task reserved for a peer is left untouched.
 */
function attributedTaskCreated(createdEvents, handle) {
  const attribution = (event) =>
    /@([\p{L}\p{N}_-]+)/u.exec(
      typeof event.payload?.title === "string" ? event.payload.title : "",
    )?.[1];
  return (
    createdEvents.find((event) => attribution(event) === handle) ??
    createdEvents.find((event) => attribution(event) === undefined)
  );
}

function findLatestRootMessage(activationEvents) {
  return [...activationEvents]
    .reverse()
    .find(
      (event) =>
        event.type === "message.posted" &&
        event.payload?.threadId === undefined &&
        typeof event.payload?.body === "string",
    );
}

function contextualDemoRoomReply(sourceMessage) {
  if (sourceMessage === undefined) return undefined;
  if (typeof sourceMessage.payload?.activationId === "string") {
    return undefined;
  }
  const agentName = agentContext?.handle?.trim() || "Agent";
  const normalizedBody = sourceMessage.payload.body
    .trim()
    .replace(/\s+/gu, " ");
  if (normalizedBody === "") return undefined;
  const preview =
    normalizedBody.length > 120
      ? `${normalizedBody.slice(0, 119)}…`
      : normalizedBody;
  return `我是 ${agentName}，当前 Room 的演示 Agent（Fake CLI）。我已收到：“${preview}”。`;
}

function turnTakingCounterRoomReply(sourceMessage) {
  if (sourceMessage === undefined) return undefined;
  const body = sourceMessage.payload.body.trim();
  if (typeof sourceMessage.payload?.activationId !== "string") {
    return /(?:1|一).*(?:10|十)/su.test(body) ? withTurnPeer("1") : undefined;
  }
  // evo §37 A: an instance wakes its peer only by an explicit @.
  const count = body.replace(/^@\S+\s+/u, "");
  if (!/^\d+$/u.test(count)) return undefined;
  const value = Number(count);
  return Number.isInteger(value) && value >= 1 && value < 10
    ? withTurnPeer(String(value + 1))
    : undefined;
}

function withTurnPeer(count) {
  const peer = process.env.RAH_FAKE_TURN_PEER;
  return peer ? `@${peer} ${count}` : count;
}
