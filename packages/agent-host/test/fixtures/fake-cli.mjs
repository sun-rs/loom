import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
  writeSync,
} from "node:fs";

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
} else if (mode === "worker-cli-sync") {
  if (process.env.RAH_AGENT_TOOL_BIN !== undefined) {
    throw new Error("internal Worker tool directory hint leaked to Runtime");
  }
  const requiredThrough = Number(process.env.RAH_TO_SEQ);
  const delivery = JSON.parse(
    execFileSync("rah", ["worker", "sync"], { encoding: "utf8" }),
  );
  if (
    !Number.isInteger(requiredThrough) ||
    !Number.isInteger(delivery.cursorAfter) ||
    delivery.cursorAfter < requiredThrough
  ) {
    throw new Error("rah Worker CLI did not deliver the Activation range");
  }
  execFileSync(
    "rah",
    ["worker", "acknowledge", "--through-seq", String(delivery.cursorAfter)],
    { encoding: "utf8" },
  );
  process.stdout.write(
    JSON.stringify({
      deliveredThrough: delivery.cursorAfter,
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
      throw error;
    }
    return result;
  };

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
        basedOnRoomSeq: delivery.cursorAfter,
        idempotencyKey: `fake:${activationId}:claim-message`,
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
  const roomReply =
    process.env.RAH_FAKE_ROOM_REPLY_MODE === "contextual-demo"
      ? contextualDemoRoomReply(activationEvents)
      : process.env.RAH_FAKE_ROOM_REPLY?.trim();
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
    if (replied.activationIds.length !== 0) {
      throw new Error("worker Room reply must not create an activation loop");
    }
    process.stdout.write(
      JSON.stringify({
        marker: "worker-room-reply-posted",
        roomSeq: replied.event.roomSeq,
      }) + "\n",
    );
    publishTrajectory({
      kind: "text",
      producerFactId: "fixture:reply:text",
      text: roomReply,
    });
  }
  const taskCreated = activationEvents.find(
    (event) => event.type === "task.created",
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
        marker: "worker-room-reply-finished",
      }) + "\n",
    );
    process.exit(0);
  }
  if (!taskId) {
    throw new Error("Activation contains no Task-linked business event");
  }
  if (
    isInputMode &&
    inputResolved &&
    inputResolved.payload?.answer !== "Yes, remain loopback-only"
  ) {
    throw new Error("resolved human input was not delivered canonically");
  }
  let basedOnRoomSeq = autoClaimedTask?.event?.roomSeq ?? delivery.cursorAfter;
  const commandId = (operation) => `fake:${taskId}:${operation}`;
  const canonical = await request("/v1/worker/tasks/get", { taskId });
  const inputStatus = isInputMode
    ? await request("/v1/worker/tasks/input-status", { taskId })
    : { inputRequest: null };

  const participantId = process.env.RAH_PARTICIPANT_ID;
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
          idempotencyKey: `fake:${taskId}:collaboration`,
        });
      }
      if (reviewWorkRequired) {
        await request("/v1/worker/tasks/review", {
          basedOnRoomSeq: delivery.cursorAfter,
          disposition: "approved",
          idempotencyKey: `fake:${taskId}:review`,
          summary: "审阅通过：提交证据与 Task 范围一致。",
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
      const claimed = await request("/v1/worker/tasks/claim", {
        basedOnRoomSeq,
        idempotencyKey: claimCommandId,
        taskId,
      });
      if (!claimed.deduplicated) {
        basedOnRoomSeq = Math.max(basedOnRoomSeq, claimed.event.roomSeq);
      }
    }
    const started = await request("/v1/worker/tasks/start", {
      basedOnRoomSeq,
      idempotencyKey: startCommandId,
      taskId,
    });
    if (!started.deduplicated) {
      basedOnRoomSeq = Math.max(basedOnRoomSeq, started.event.roomSeq);
    }

    const resumeMarkerPath = process.env.RAH_FAKE_RESUME_MARKER;
    if (isInputMode && !inputResolved) {
      const requested = await request("/v1/worker/tasks/request-input", {
        basedOnRoomSeq,
        idempotencyKey: commandId("request-input"),
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
      const progressed = await request("/v1/worker/tasks/progress", {
        basedOnRoomSeq,
        idempotencyKey: commandId("progress"),
        progress: "Fake Worker verified the daemon Task command path",
        taskId,
      });
      if (!progressed.deduplicated) {
        basedOnRoomSeq = Math.max(basedOnRoomSeq, progressed.event.roomSeq);
      }
      const submitted = await request("/v1/worker/tasks/submit", {
        basedOnRoomSeq,
        idempotencyKey: commandId("submit"),
        summary: "Fake Worker completed the durable Task protocol",
        taskId,
      });
      await request("/v1/worker/acknowledge", {
        throughSeq: delivery.cursorAfter,
      });
      process.stdout.write(
        JSON.stringify({
          marker: "worker-task-finished",
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

function contextualDemoRoomReply(activationEvents) {
  const sourceMessage = [...activationEvents]
    .reverse()
    .find(
      (event) =>
        event.type === "message.posted" &&
        event.payload?.threadId === undefined &&
        typeof event.payload?.body === "string",
    );
  if (sourceMessage === undefined) return undefined;
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
