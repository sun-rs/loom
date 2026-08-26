import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const mode = process.env.RAH_FAKE_MODE ?? "success";

if (mode === "ignore-term" || mode === "ignore-term-with-child") {
  process.on("SIGTERM", () => {
    process.stderr.write("ignored SIGTERM\n");
  });
}

process.stdout.write(
  JSON.stringify({
    activationId: process.env.RAH_ACTIVATION_ID,
    hasSupervisorConfig:
      process.env.RAH_PROCESS_SUPERVISOR_CONFIG !== undefined,
    hasSupervisorToken: process.env.RAH_PROCESS_SUPERVISOR_TOKEN !== undefined,
    marker: "opaque-fake-cli-output",
    mode,
  }) + "\n",
);
process.stderr.write(`fake-cli diagnostic mode=${mode}\n`);

if (mode === "success") {
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
      writeFileSync(
        pidFile,
        JSON.stringify({ childPid: child.pid, leaderPid: process.pid }),
      );
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
      writeFileSync(
        pidFile,
        JSON.stringify({ childPid: child.pid, leaderPid: process.pid }),
      );
    }
    process.stderr.write(`child-ready pid=${child.pid}\n`);
  });
  setInterval(() => {}, 1_000);
} else if (mode === "noisy") {
  process.stdout.write("o".repeat(4_096));
  process.stderr.write("e".repeat(4_096));
} else if (mode === "worker-sync") {
  const baseUrl = process.env.RAH_WORKER_API_URL;
  const token = process.env.RAH_WORKER_TOKEN;
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
} else if (
  mode === "worker-task" ||
  mode === "worker-task-resume" ||
  mode === "worker-task-input" ||
  mode === "worker-task-input-resume"
) {
  const baseUrl = process.env.RAH_WORKER_API_URL;
  const token = process.env.RAH_WORKER_TOKEN;
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
      throw new Error(
        `worker Task command ${path} failed with HTTP ${response.status}: ${JSON.stringify(result)}`,
      );
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
  const activationEvents = events.filter(
    (event) =>
      event.roomSeq >= requiredFrom && event.roomSeq <= requiredThrough,
  );
  const taskCreated = activationEvents.find(
    (event) => event.type === "task.created",
  );
  const inputResolved = activationEvents.find(
    (event) => event.type === "input.resolved",
  );
  const isInputMode =
    mode === "worker-task-input" || mode === "worker-task-input-resume";
  const taskId = taskCreated?.aggregateId ?? inputResolved?.payload?.taskId;
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
  let basedOnRoomSeq = delivery.cursorAfter;
  const commandId = (operation) => `fake:${taskId}:${operation}`;
  const canonical = await request("/v1/worker/tasks/get", { taskId });
  const inputStatus = isInputMode
    ? await request("/v1/worker/tasks/input-status", { taskId })
    : { inputRequest: null };

  if (inputStatus.inputRequest && !inputResolved) {
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
    const claimed = await request("/v1/worker/tasks/claim", {
      basedOnRoomSeq,
      idempotencyKey: claimCommandId,
      taskId,
    });
    if (!claimed.deduplicated) {
      basedOnRoomSeq = Math.max(basedOnRoomSeq, claimed.event.roomSeq);
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
    }
  }
} else {
  process.stderr.write(`unknown mode ${mode}\n`);
  process.exitCode = 64;
}
