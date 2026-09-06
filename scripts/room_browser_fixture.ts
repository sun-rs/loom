import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  RoomActivationLedger,
  RoomLedger,
} from "../packages/runtime-daemon/src/room/index.ts";
import type { RoomEvent, RoomWorkerExecution } from "@rah/runtime-protocol";

const dataRoot = process.argv[2];
const resultPath = process.argv[3];
if (
  !dataRoot ||
  !path.isAbsolute(dataRoot) ||
  !resultPath ||
  !path.isAbsolute(resultPath)
) {
  throw new Error(
    "usage: room_browser_fixture.ts <absolute-data-root> <absolute-result-path>",
  );
}

const roomRoot = path.join(dataRoot, "room");
mkdirSync(roomRoot, { recursive: true, mode: 0o700 });
let sequence = 0;
const now = () => new Date("2026-09-06T12:00:00.000Z");
const createId = (prefix: string) => `${prefix}-browser-${++sequence}`;
const ledger = new RoomLedger(path.join(roomRoot, "room.db"), {
  now,
  createId,
});
const activations = new RoomActivationLedger(path.join(roomRoot, "room.db"), {
  now,
  createId,
});

function executionFor(
  participantId: string,
  event: RoomEvent,
  label: string,
): {
  execution: RoomWorkerExecution;
  activationId: string;
  leaseToken: string;
  runAttemptId: string;
  workerId: string;
} {
  activations.enqueue({
    schema: "rah.room-wake.v1",
    hintId: `${label}-hint`,
    topic: "inbox.available",
    eventId: event.eventId,
    participantId,
    reason: "task_assignment",
    disposition: "activation",
    roomId: event.roomId,
    roomSeq: event.roomSeq,
  });
  const workerId = `${label}-host`;
  const activation = activations.leaseNext(workerId, {
    participantId,
    leaseMs: 30_000,
  });
  if (!activation?.leaseToken)
    throw new Error(`missing activation for ${participantId}`);
  activations.acknowledgePull(
    workerId,
    activation.activationId,
    activation.leaseToken,
    activation.toSeq,
  );
  const prepared = activations.createRunAttempt(
    workerId,
    activation.activationId,
    activation.leaseToken,
    {
      runtimeProfileId: `${label}-profile`,
      provider: "fake",
      workspace: "/tmp/rah-room-browser",
    },
  );
  const running = activations.startRunAttempt(
    workerId,
    activation.activationId,
    activation.leaseToken,
    prepared.runAttemptId,
  );
  return {
    workerId,
    activationId: activation.activationId,
    leaseToken: activation.leaseToken,
    runAttemptId: running.runAttemptId,
    execution: {
      ...activations.workerExecution(
        workerId,
        activation.activationId,
        activation.leaseToken,
        running.runAttemptId,
      ),
      hostEvidence: {
        schemaVersion: 1,
        workspaceRoot: "/tmp/rah-room-browser",
        baseRevision: "base-browser",
        headRevision: "head-browser",
        patchDigest: `sha256:${"a".repeat(64)}`,
        verificationDigest: `sha256:${"b".repeat(64)}`,
        observedAt: now().toISOString(),
      },
    },
  };
}

function finish(run: ReturnType<typeof executionFor>): void {
  activations.finishRunAttempt(
    run.workerId,
    run.activationId,
    run.leaseToken,
    run.runAttemptId,
    { state: "exited", exitCode: 0 },
  );
  activations.complete(run.workerId, run.activationId, run.leaseToken);
}

try {
  const owner = ledger.ensureLocalHumanPrincipal({
    handle: "owner",
    displayName: "Local Owner",
  });
  const worker = ledger.provisionPrincipal({
    principalId: "agent-browser-worker",
    handle: "alice",
    displayName: "Alice",
    kind: "agent",
  });
  const reviewer = ledger.provisionPrincipal({
    principalId: "agent-browser-reviewer",
    handle: "cindy",
    displayName: "Cindy",
    kind: "agent",
  });
  const created = ledger.createRoom(owner.principalId, {
    roomId: "room-browser-audit",
    workspaceKey: "local-workbench",
    kind: "channel",
    slug: "browser-audit",
    name: "Browser Audit",
    visibility: "private",
    idempotencyKey: "browser-room-create",
  });
  const withWorker = ledger.addMember(owner.principalId, {
    roomId: created.value.roomId,
    principalId: worker.principalId,
    role: "member",
    basedOnRoomSeq: created.event.roomSeq,
    idempotencyKey: "browser-add-worker",
  });
  ledger.addMember(owner.principalId, {
    roomId: created.value.roomId,
    principalId: reviewer.principalId,
    role: "member",
    basedOnRoomSeq: withWorker.event.roomSeq,
    idempotencyKey: "browser-add-reviewer",
  });

  for (let index = 1; index <= 205; index += 1) {
    ledger.postMessage(owner.principalId, {
      roomId: created.value.roomId,
      body: `Bounded history fixture ${String(index).padStart(3, "0")}`,
      idempotencyKey: `browser-history-${index}`,
    });
  }

  const submittedSource = ledger.postMessage(owner.principalId, {
    roomId: created.value.roomId,
    body: "Deliver the audited Room workflow",
    idempotencyKey: "browser-submitted-source",
  });
  const submittedTask = ledger.createTask(owner.principalId, {
    roomId: created.value.roomId,
    sourceMessageId: submittedSource.value.messageId,
    title: "Audited delivery awaiting Human acceptance",
    assigneeId: worker.principalId,
    reviewerIds: [reviewer.principalId],
    basedOnRoomSeq: submittedSource.event.roomSeq,
    idempotencyKey: "browser-submitted-task",
  });
  const workerRun = executionFor(
    worker.principalId,
    submittedTask.event,
    "browser-worker",
  );
  const claimed = ledger.claimTask(workerRun.execution, {
    taskId: submittedTask.value.taskId,
    basedOnRoomSeq: submittedTask.event.roomSeq,
    leaseMs: 30_000,
    idempotencyKey: "browser-claim-task",
  });
  const started = ledger.startTask(workerRun.execution, {
    taskId: submittedTask.value.taskId,
    basedOnRoomSeq: claimed.event.roomSeq,
    idempotencyKey: "browser-start-task",
  });
  const submitted = ledger.submitTask(workerRun.execution, {
    taskId: submittedTask.value.taskId,
    basedOnRoomSeq: started.event.roomSeq,
    summary: "Frozen browser fixture delivery.",
    idempotencyKey: "browser-submit-task",
  });
  finish(workerRun);
  const reviewerRun = executionFor(
    reviewer.principalId,
    submitted.event,
    "browser-reviewer",
  );
  const review = ledger.reviewTask(reviewerRun.execution, {
    taskId: submittedTask.value.taskId,
    basedOnRoomSeq: submitted.event.roomSeq,
    disposition: "approved",
    summary: "Independent browser fixture review approved.",
    idempotencyKey: "browser-review-task",
  });
  finish(reviewerRun);

  const todoSource = ledger.postMessage(owner.principalId, {
    roomId: created.value.roomId,
    body: "A later task must remain canonical todo",
    idempotencyKey: "browser-todo-source",
  });
  ledger.createTask(owner.principalId, {
    roomId: created.value.roomId,
    sourceMessageId: todoSource.value.messageId,
    title: "Canonical todo task",
    assigneeId: worker.principalId,
    reviewerIds: [reviewer.principalId],
    basedOnRoomSeq: todoSource.event.roomSeq,
    idempotencyKey: "browser-todo-task",
  });

  const second = ledger.createRoom(owner.principalId, {
    roomId: "room-browser-second",
    workspaceKey: "local-workbench",
    kind: "channel",
    slug: "second-room",
    name: "Second Room",
    visibility: "private",
    idempotencyKey: "browser-second-room",
  });
  ledger.postMessage(owner.principalId, {
    roomId: second.value.roomId,
    body: "Profile panels must close when Room ownership changes.",
    idempotencyKey: "browser-second-message",
  });

  const empty = ledger.createRoom(owner.principalId, {
    roomId: "room-browser-empty",
    workspaceKey: "local-workbench",
    kind: "channel",
    slug: "empty-room",
    name: "Empty Room",
    visibility: "private",
    idempotencyKey: "browser-empty-room",
  });

  const offscreen = ledger.createRoom(owner.principalId, {
    roomId: "room-browser-offscreen-tasks",
    workspaceKey: "local-workbench",
    kind: "channel",
    slug: "offscreen-tasks",
    name: "Offscreen Tasks",
    visibility: "private",
    idempotencyKey: "browser-offscreen-room",
  });
  const offscreenWorker = ledger.addMember(owner.principalId, {
    roomId: offscreen.value.roomId,
    principalId: worker.principalId,
    role: "member",
    basedOnRoomSeq: offscreen.event.roomSeq,
    idempotencyKey: "browser-offscreen-add-worker",
  });
  ledger.addMember(owner.principalId, {
    roomId: offscreen.value.roomId,
    principalId: reviewer.principalId,
    role: "member",
    basedOnRoomSeq: offscreenWorker.event.roomSeq,
    idempotencyKey: "browser-offscreen-add-reviewer",
  });
  const offscreenSource = ledger.postMessage(owner.principalId, {
    roomId: offscreen.value.roomId,
    body: "This review must remain pending while its Task card is offscreen",
    idempotencyKey: "browser-offscreen-source",
  });
  const offscreenTask = ledger.createTask(owner.principalId, {
    roomId: offscreen.value.roomId,
    sourceMessageId: offscreenSource.value.messageId,
    title: "Horizontally offscreen review",
    assigneeId: worker.principalId,
    reviewerIds: [reviewer.principalId],
    basedOnRoomSeq: offscreenSource.event.roomSeq,
    idempotencyKey: "browser-offscreen-task",
  });
  const offscreenWorkerRun = executionFor(
    worker.principalId,
    offscreenTask.event,
    "browser-offscreen-worker",
  );
  const offscreenClaimed = ledger.claimTask(offscreenWorkerRun.execution, {
    taskId: offscreenTask.value.taskId,
    basedOnRoomSeq: offscreenTask.event.roomSeq,
    leaseMs: 30_000,
    idempotencyKey: "browser-offscreen-claim",
  });
  const offscreenStarted = ledger.startTask(offscreenWorkerRun.execution, {
    taskId: offscreenTask.value.taskId,
    basedOnRoomSeq: offscreenClaimed.event.roomSeq,
    idempotencyKey: "browser-offscreen-start",
  });
  const offscreenSubmitted = ledger.submitTask(offscreenWorkerRun.execution, {
    taskId: offscreenTask.value.taskId,
    basedOnRoomSeq: offscreenStarted.event.roomSeq,
    summary: "Frozen offscreen browser fixture delivery.",
    idempotencyKey: "browser-offscreen-submit",
  });
  finish(offscreenWorkerRun);
  const offscreenReviewerRun = executionFor(
    reviewer.principalId,
    offscreenSubmitted.event,
    "browser-offscreen-reviewer",
  );
  const offscreenReview = ledger.reviewTask(offscreenReviewerRun.execution, {
    taskId: offscreenTask.value.taskId,
    basedOnRoomSeq: offscreenSubmitted.event.roomSeq,
    disposition: "approved",
    summary: "Offscreen browser fixture review approved.",
    idempotencyKey: "browser-offscreen-review",
  });
  finish(offscreenReviewerRun);

  // Keep the deep-linked Room beyond the first 200 catalog rows. The browser
  // must follow the frozen opaque cursor rather than silently falling back.
  for (let index = 1; index <= 205; index += 1) {
    const suffix = String(index).padStart(3, "0");
    ledger.createRoom(owner.principalId, {
      roomId: `room-browser-filler-${suffix}`,
      workspaceKey: "local-workbench",
      kind: "channel",
      slug: `filler-${suffix}`,
      name: `Filler Room ${suffix}`,
      visibility: "private",
      idempotencyKey: `browser-filler-room-${suffix}`,
    });
  }

  writeFileSync(
    resultPath,
    JSON.stringify(
      {
        roomId: created.value.roomId,
        secondRoomId: second.value.roomId,
        emptyRoomId: empty.value.roomId,
        offscreenRoomId: offscreen.value.roomId,
        offscreenTaskId: offscreenTask.value.taskId,
        offscreenReviewAttentionEventId: offscreenReview.event.eventId,
        submittedTaskId: submittedTask.value.taskId,
        submittedSourceMessageId: submittedSource.value.messageId,
        reviewAttentionEventId: review.event.eventId,
        reviewedAtRoomSeq: review.event.roomSeq,
        ownerId: owner.principalId,
        workerId: worker.principalId,
        reviewerId: reviewer.principalId,
        expectedCatalogSize: 209,
      },
      null,
      2,
    ),
  );
} finally {
  activations.close();
  ledger.close();
}
