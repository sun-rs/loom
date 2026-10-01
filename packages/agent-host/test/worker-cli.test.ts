import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Readable } from "node:stream";

import { WORKER_MESSAGE_RESOLVE_NOT_FOUND_NEXT_ACTION } from "@rah-os/protocol";

import { runWorkerCliCommand } from "../src/index.ts";
import {
  SEND_IDEMPOTENCY_CONFLICT_NEXT_ACTION,
  SEND_REJECTED_NEXT_ACTION,
} from "../src/worker-cli-error.ts";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-worker-cli-"));
  chmodSync(directory, 0o700);
  const tokenPath = join(directory, "token");
  writeFileSync(tokenPath, "worker-secret", { mode: 0o600 });
  const requests: Array<{ body: unknown; headers: Headers; url: string }> = [];
  let stdout = "";
  let stderr = "";
  return {
    directory,
    requests,
    runtime: {
      env: {
        RAH_ACTIVATION_ID: "activation-cli-1",
        RAH_WORKER_API_URL: "http://127.0.0.1:43123",
        RAH_WORKER_SESSION_FILE: tokenPath,
      },
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          body: JSON.parse(String(init?.body ?? "{}")) as unknown,
          headers: new Headers(init?.headers),
          url: String(input),
        });
        if (String(input).endsWith("/tasks/claim-batch")) {
          const body = JSON.parse(String(init?.body));
          return new Response(
            JSON.stringify({
              roomId: "room-test",
              results: body.taskNumbers.map((taskNumber: number) => ({
                success: true,
                taskNumber,
                taskId: `task-${taskNumber}`,
                messageId: `message-${taskNumber}`,
                threadId: `thread-${taskNumber}`,
                state: "claimed",
              })),
              tasks: [],
              deduplicated: false,
            }),
          );
        }
        return new Response(JSON.stringify({ ok: true, roomSeq: 7 }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      },
      stderr: { write: (value: string) => (stderr += value) },
      stdout: { write: (value: string) => (stdout += value) },
    },
    stderr: () => stderr,
    stdout: () => stdout,
    tokenPath,
  };
}

test("Worker CLI maps bounded commands to the activation-scoped application port", async () => {
  const state = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "sync", "--after-seq", "4"],
        state.runtime,
      ),
      0,
    );
    assert.deepEqual(state.requests[0]?.body, { afterSeq: 4 });
    assert.equal(
      state.requests[0]?.url,
      "http://127.0.0.1:43123/v1/worker/sync",
    );
    assert.equal(
      state.requests[0]?.headers.get("authorization"),
      "Bearer worker-secret",
    );
    // Raft renders `message check` as text and terminates the drain; RAH's
    // `sync` is the same outcome, so it renders text rather than a payload.
    assert.equal(
      state.stdout(),
      [
        "Sync window: 0 delivered, cursor - to - of -.",
        "",
        "No new inbox messages.",
        "",
        "No more new inbox messages.",
        "",
      ].join("\n"),
    );
    assert.equal(state.stderr(), "");
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("Raft-shaped Reminder CLI maps schedule, recurrence, snooze, and log to Worker authority", async () => {
  const state = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(
        [
          "reminder",
          "schedule",
          "--title",
          "Publish the report",
          "--delay-seconds",
          "1800",
          "--message-id",
          "message-7",
          "--based-on-room-seq",
          "7",
          "--repeat",
          "daily@09:00",
          "--tz",
          "Asia/Shanghai",
          "--idempotency-key",
          "reminder-schedule-7",
        ],
        state.runtime,
      ),
      0,
    );
    assert.deepEqual(state.requests[0]?.body, {
      basedOnRoomSeq: 7,
      delaySeconds: 1_800,
      idempotencyKey: "reminder-schedule-7",
      messageId: "message-7",
      repeat: "daily@09:00",
      timezone: "Asia/Shanghai",
      title: "Publish the report",
    });
    assert.equal(
      state.requests[0]?.url,
      "http://127.0.0.1:43123/v1/worker/reminders/schedule",
    );
    assert.equal(
      await runWorkerCliCommand(
        ["reminder", "snooze", "--id", "reminder-7", "--by", "2h"],
        state.runtime,
      ),
      0,
    );
    assert.equal(
      state.requests[1]?.url,
      "http://127.0.0.1:43123/v1/worker/reminders/snooze",
    );
    assert.equal(
      (state.requests[1]?.body as Record<string, unknown>).delaySeconds,
      7_200,
    );
    assert.equal(
      await runWorkerCliCommand(
        ["reminder", "log", "--id", "reminder-7"],
        state.runtime,
      ),
      0,
    );
    assert.equal(
      state.requests[2]?.url,
      "http://127.0.0.1:43123/v1/worker/reminders/log",
    );
    assert.equal(
      await runWorkerCliCommand(
        ["reminder", "list", "--status", "scheduled,fired"],
        state.runtime,
      ),
      0,
    );
    assert.deepEqual(state.requests[3]?.body, {
      statuses: ["scheduled", "fired"],
    });
    assert.equal(
      await runWorkerCliCommand(
        [
          "reminder",
          "update",
          "--id",
          "reminder-7",
          "--cadence",
          "weekly:mon,fri@09:00",
          "--tz",
          "Asia/Shanghai",
        ],
        state.runtime,
      ),
      0,
    );
    assert.equal(
      (state.requests[4]?.body as Record<string, unknown>).repeat,
      "weekly:mon,fri@09:00",
    );
    assert.equal(
      await runWorkerCliCommand(
        [
          "reminder",
          "schedule",
          "--title",
          "Cross-room reminder",
          "--delay-seconds",
          "30",
          "--message-id",
          "message-7",
          "--based-on-room-seq",
          "7",
          "--channel",
          "#other-room",
        ],
        state.runtime,
      ),
      0,
    );
    assert.equal(state.requests.length, 6);
    assert.equal(
      (state.requests[5]?.body as Record<string, unknown>).channel,
      "#other-room",
    );
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("Raft-shaped config CLI reads revision before patch and never retries a conflicting write", async () => {
  const state = fixture();
  const calls: { url: string; body: unknown }[] = [];
  try {
    const result = await runWorkerCliCommand(
      ["app", "config", "--app", "system.cleaner", "--set", "enabled=false"],
      {
        ...state.runtime,
        env: {
          RAH_AGENT_INBOX_API_URL: "http://127.0.0.1:43123",
          RAH_AGENT_INBOX_SESSION_FILE: state.tokenPath,
        },
        fetch: async (url, options) => {
          calls.push({ url, body: JSON.parse(String(options.body)) });
          return calls.length === 1
            ? new Response(
                JSON.stringify({
                  appId: "system.cleaner",
                  ownerParticipantId: "alice",
                  revision: 7,
                  overrides: {},
                  effective: {
                    enabled: true,
                    threshold_bytes: 65536,
                    interval_ms: 3600000,
                  },
                }),
              )
            : new Response(
                JSON.stringify({ error: { message: "revision conflict" } }),
                { status: 409 },
              );
        },
      },
    );
    assert.equal(result, 1);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1]?.body, {
      expectedRevision: 7,
      set: { enabled: false },
      unset: [],
    });
    assert.equal(state.stdout(), "");
    assert.match(state.stderr(), /revision conflict/);
  } finally {
    rmSync(state.directory, { recursive: true, force: true });
  }
});

test("Worker CLI task submit requires an explicit causal sequence and stable idempotency key", async () => {
  const state = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "task-submit",
          "--task-id",
          "task-1",
          "--summary",
          "Implemented and verified",
          "--based-on-room-seq",
          "6",
          "--idempotency-key",
          "submit:task-1:attempt-1",
        ],
        state.runtime,
      ),
      0,
    );
    assert.deepEqual(state.requests[0]?.body, {
      basedOnRoomSeq: 6,
      idempotencyKey: "submit:task-1:attempt-1",
      summary: "Implemented and verified",
      taskId: "task-1",
    });
    assert.equal(
      state.requests[0]?.url,
      "http://127.0.0.1:43123/v1/worker/tasks/submit",
    );
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("Worker CLI exposes the current frozen Task submission without accepting a submission selector", async () => {
  const state = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "task-submission", "--task-id", "task-1"],
        state.runtime,
      ),
      0,
    );
    assert.deepEqual(state.requests[0]?.body, { taskId: "task-1" });
    assert.equal(
      state.requests[0]?.url,
      "http://127.0.0.1:43123/v1/worker/tasks/submission",
    );
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("Worker CLI labels verification as a producer declaration and freezes referenced artifacts", async () => {
  const state = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "task-submit",
          "--task-id",
          "task-1",
          "--summary",
          "Implemented and verified",
          "--verification-status",
          "passed",
          "--verification-summary",
          "npm test passed",
          "--verification-artifact-ids",
          "artifact-1,artifact-2",
          "--based-on-room-seq",
          "6",
          "--idempotency-key",
          "submit:task-1:attempt-1",
        ],
        state.runtime,
      ),
      0,
    );
    assert.deepEqual(state.requests[0]?.body, {
      basedOnRoomSeq: 6,
      idempotencyKey: "submit:task-1:attempt-1",
      summary: "Implemented and verified",
      taskId: "task-1",
      verification: {
        artifactIds: ["artifact-1", "artifact-2"],
        status: "passed",
        summary: "npm test passed",
      },
    });
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("Worker CLI exposes Raft-shaped explicit Thread unfollow without routing injection", async () => {
  const state = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "thread-unfollow",
          "--thread-id",
          "thread-1",
          "--based-on-room-seq",
          "8",
          "--idempotency-key",
          "thread-unfollow:thread-1:agent-1",
        ],
        state.runtime,
      ),
      0,
    );
    assert.deepEqual(state.requests[0]?.body, {
      basedOnRoomSeq: 8,
      idempotencyKey: "thread-unfollow:thread-1:agent-1",
      // Raft always sends a reason and defaults it to this exact wording.
      reason: "no longer following",
      threadId: "thread-1",
    });
    assert.equal(
      state.requests[0]?.url,
      "http://127.0.0.1:43123/v1/worker/threads/unfollow",
    );
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("Worker CLI exposes Raft-shaped held draft resend and gates send-anyway behind it", async () => {
  const state = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "message-post",
          "--send-draft",
          "--held-draft-id",
          "held-draft-2",
          "--anyway",
          "--based-on-room-seq",
          "12",
          "--idempotency-key",
          "send-draft:held-draft-2:attempt-3",
        ],
        state.runtime,
      ),
      0,
    );
    assert.deepEqual(state.requests[0]?.body, {
      anyway: true,
      basedOnRoomSeq: 12,
      heldDraftId: "held-draft-2",
      idempotencyKey: "send-draft:held-draft-2:attempt-3",
      sendDraft: true,
    });
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "message-post",
          "--body",
          "Bypass this composed text",
          "--anyway",
          "--based-on-room-seq",
          "12",
          "--idempotency-key",
          "invalid-anyway",
        ],
        state.runtime,
      ),
      1,
    );
    assert.match(state.stderr(), /--anyway requires --send-draft/u);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("Worker CLI explicitly publishes a local file without sending its host path to the daemon", async () => {
  const state = fixture();
  const filePath = join(state.directory, "evidence.txt");
  writeFileSync(filePath, "artifact-evidence!", { mode: 0o600 });
  const requests: Array<{
    body: string;
    headers: Headers;
    method: string | undefined;
    url: string;
  }> = [];
  try {
    const result = await runWorkerCliCommand(
      [
        "worker",
        "artifact-publish",
        "--task-id",
        "task-1",
        "--path",
        filePath,
        "--mime-type",
        "text/plain",
        "--idempotency-key",
        "artifact:task-1:evidence",
      ],
      {
        ...state.runtime,
        fetch: async (input, init) => {
          const body =
            typeof init?.body === "string"
              ? init.body
              : Buffer.from(
                  await new Response(init?.body ?? null).arrayBuffer(),
                ).toString("utf8");
          requests.push({
            body,
            headers: new Headers(init?.headers),
            method: init?.method,
            url: String(input),
          });
          return requests.length === 1
            ? new Response(
                JSON.stringify({
                  attachmentId: "attachment-1",
                  expiresAt: "2026-09-01T01:00:00.000Z",
                  filename: "evidence.txt",
                  mimeType: "text/plain",
                  roomId: "room-1",
                  size: 18,
                  state: "pending",
                  taskId: "task-1",
                }),
              )
            : new Response(
                JSON.stringify({
                  attachmentId: "attachment-1",
                  expiresAt: "2026-09-01T01:00:00.000Z",
                  filename: "evidence.txt",
                  mimeType: "text/plain",
                  roomId: "room-1",
                  sha256:
                    "0d612265f5b74df4d813cf768c288f6dc27872470cd02e763c130b0bdaafbe51",
                  size: 18,
                  state: "completed",
                  taskId: "task-1",
                }),
              );
        },
      },
    );
    assert.equal(result, 0, state.stderr());
    assert.equal(requests.length, 2);
    assert.equal(
      requests[0]?.url,
      "http://127.0.0.1:43123/v1/worker/artifacts/prepare",
    );
    assert.deepEqual(JSON.parse(requests[0]!.body), {
      filename: "evidence.txt",
      idempotencyKey: "artifact:task-1:evidence",
      mimeType: "text/plain",
      size: 18,
      taskId: "task-1",
    });
    assert.equal(requests[0]?.body.includes(filePath), false);
    assert.equal(requests[1]?.method, "PUT");
    assert.equal(
      requests[1]?.url,
      "http://127.0.0.1:43123/v1/worker/artifacts/attachment-1",
    );
    assert.equal(requests[1]?.body, "artifact-evidence!");
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("Worker CLI downloads one frozen Task Artifact without placing bytes in JSON context", async () => {
  const state = fixture();
  const output = join(state.directory, "review.patch");
  let request:
    { authorization: string | null; method: string; url: string } | undefined;
  state.runtime.fetch = async (input, init) => {
    request = {
      authorization: new Headers(init?.headers).get("authorization"),
      method: init?.method ?? "GET",
      url: String(input),
    };
    return new Response("frozen patch\n", { status: 200 });
  };
  try {
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "artifact-download",
          "--attachment-id",
          "11111111-1111-4111-8111-111111111111",
          "--output",
          output,
        ],
        state.runtime,
      ),
      0,
    );
    assert.deepEqual(request, {
      authorization: "Bearer worker-secret",
      method: "GET",
      url: "http://127.0.0.1:43123/v1/worker/artifacts/11111111-1111-4111-8111-111111111111",
    });
    assert.equal(readFileSync(output, "utf8"), "frozen patch\n");
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("Worker CLI exposes structured Task Review without reviewer identity injection", async () => {
  const state = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "task-review",
          "--task-id",
          "task-1",
          "--disposition",
          "approved",
          "--summary",
          "Frozen submission evidence passes review",
          "--based-on-room-seq",
          "9",
          "--idempotency-key",
          "review:task-1:submission-1",
        ],
        state.runtime,
      ),
      0,
    );
    assert.deepEqual(state.requests[0]?.body, {
      basedOnRoomSeq: 9,
      disposition: "approved",
      idempotencyKey: "review:task-1:submission-1",
      summary: "Frozen submission evidence passes review",
      taskId: "task-1",
    });
    assert.equal(
      state.requests[0]?.url,
      "http://127.0.0.1:43123/v1/worker/tasks/review",
    );
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "task-review",
          "--task-id",
          "task-1",
          "--disposition",
          "commented",
          "--summary",
          "Invalid disposition",
          "--based-on-room-seq",
          "9",
          "--idempotency-key",
          "review:invalid",
        ],
        state.runtime,
      ),
      1,
    );
    assert.equal(state.requests.length, 1);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("Worker CLI exposes one bounded message-to-Task claim command", async () => {
  const state = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "task-claim-message",
          "--message-id",
          "message-long-work",
          "--rationale",
          "Requires persistent edits, progress, and review",
          "--based-on-room-seq",
          "6",
          "--idempotency-key",
          "claim-message:activation-1",
        ],
        state.runtime,
      ),
      0,
    );
    assert.deepEqual(state.requests[0]?.body, {
      basedOnRoomSeq: 6,
      idempotencyKey: "claim-message:activation-1",
      messageId: "message-long-work",
      rationale: "Requires persistent edits, progress, and review",
    });
    assert.equal(
      state.requests[0]?.url,
      "http://127.0.0.1:43123/v1/worker/tasks/claim-message",
    );
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("Worker CLI exposes one bounded Task creation command", async () => {
  const state = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "task-create",
          "--title",
          "Split: migration",
          "--based-on-room-seq",
          "6",
          "--idempotency-key",
          "create:activation-1",
        ],
        state.runtime,
      ),
      0,
    );
    assert.deepEqual(state.requests[0]?.body, {
      basedOnRoomSeq: 6,
      idempotencyKey: "create:activation-1",
      title: "Split: migration",
    });
    assert.equal(
      state.requests[0]?.url,
      "http://127.0.0.1:43123/v1/worker/tasks/create",
    );
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "task-create",
          "--title",
          "Split: migration follow-up",
          "--assignee",
          "agent-self",
          "--based-on-room-seq",
          "7",
          "--idempotency-key",
          "create:activation-2",
        ],
        state.runtime,
      ),
      0,
    );
    assert.deepEqual(state.requests[1]?.body, {
      assigneeId: "agent-self",
      basedOnRoomSeq: 7,
      idempotencyKey: "create:activation-2",
      title: "Split: migration follow-up",
    });
    assert.notEqual(
      await runWorkerCliCommand(
        [
          "worker",
          "task-create",
          "--based-on-room-seq",
          "8",
          "--idempotency-key",
          "create:activation-3",
        ],
        state.runtime,
      ),
      0,
    );
    assert.equal(state.requests.length, 2);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("Worker CLI no longer advertises or dispatches retired managed MCP tools", async () => {
  const state = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(["worker", "help"], state.runtime),
      0,
    );
    assert.doesNotMatch(state.stdout(), /mcp-tools|mcp-call/u);
    for (const command of ["mcp-tools", "mcp-call"])
      assert.equal(
        await runWorkerCliCommand(["worker", command], state.runtime),
        1,
      );
    assert.equal(state.requests.length, 0);
    assert.equal(
      await runWorkerCliCommand(["worker", "sync"], state.runtime),
      0,
    );
    assert.equal(state.requests.length, 1);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("Worker CLI fails closed on unknown flags and unsafe token files", async () => {
  const state = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "sync", "--unexpected", "1"],
        state.runtime,
      ),
      1,
    );
    assert.match(state.stderr(), /unknown option/u);
    assert.equal(state.requests.length, 0);

    chmodSync(state.tokenPath, 0o644);
    assert.equal(
      await runWorkerCliCommand(["worker", "sync"], state.runtime),
      1,
    );
    assert.match(state.stderr(), /owner-private/u);
    assert.equal(state.requests.length, 0);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

for (const [command, limit] of [
  ["server-info", 512 * 1024],
  ["sync", 2 * 1024 * 1024],
] as const) {
  test(
    `Worker CLI cancels an oversized ${command} response without exposing its credential`,
    { timeout: 5000 },
    async () => {
      const state = fixture();
      let cancelled = false;
      try {
        const responseBody = new ReadableStream<Uint8Array>({
          cancel: () => {
            cancelled = true;
          },
          start: (controller) => {
            controller.enqueue(new Uint8Array(limit + 1));
          },
        });
        assert.equal(
          await runWorkerCliCommand(["worker", command], {
            ...state.runtime,
            fetch: async () => new Response(responseBody, { status: 200 }),
          }),
          1,
        );
        assert.equal(cancelled, true);
        assert.match(state.stderr(), /response exceeds the safe byte limit/u);
        assert.doesNotMatch(state.stderr(), /worker-secret/u);
        assert.equal(state.stdout(), "");
      } finally {
        rmSync(state.directory, { force: true, recursive: true });
      }
    },
  );
}

test("Worker message tools use fixed routes and reject actor/Room injection", async () => {
  const state = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-search", "--query", "needle", "--limit", "2"],
        state.runtime,
      ),
      0,
    );
    assert.deepEqual(state.requests.at(-1)?.body, {
      query: "needle",
      limit: 2,
    });
    assert.equal(
      state.requests.at(-1)?.url,
      "http://127.0.0.1:43123/v1/worker/messages/search",
    );
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "message-react",
          "--message-id",
          "m1",
          "--emoji",
          "👍",
          "--active",
          "false",
          "--based-on-room-seq",
          "8",
          "--idempotency-key",
          "r1",
        ],
        state.runtime,
      ),
      0,
    );
    assert.equal(
      state.requests.at(-1)?.url,
      "http://127.0.0.1:43123/v1/worker/messages/react",
    );
    assert.deepEqual(state.requests.at(-1)?.body, {
      messageId: "m1",
      emoji: "👍",
      active: false,
      basedOnRoomSeq: 8,
      idempotencyKey: "r1",
    });
    const count = state.requests.length;
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-search", "--query", "needle", "--room-id", "other"],
        state.runtime,
      ),
      1,
    );
    assert.equal(state.requests.length, count);
  } finally {
    rmSync(state.directory, { recursive: true, force: true });
  }
});

test("Worker CLI reads the owner's Task trajectory for a bounded reviewer page", async () => {
  const state = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "task-trajectory", "--task-id", "task-1", "--limit", "5"],
        state.runtime,
      ),
      0,
    );
    assert.deepEqual(state.requests[0]?.body, { limit: 5, taskId: "task-1" });
    assert.equal(
      state.requests[0]?.url,
      "http://127.0.0.1:43123/v1/worker/tasks/trajectory",
    );
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("Worker CLI pages Task trajectory without accepting a participant selector", async () => {
  const state = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "task-trajectory",
          "--task-id",
          "task-1",
          "--before-sequence",
          "12",
        ],
        state.runtime,
      ),
      0,
    );
    assert.deepEqual(state.requests[0]?.body, {
      beforeSequence: 12,
      taskId: "task-1",
    });
    assert.notEqual(
      await runWorkerCliCommand(
        [
          "worker",
          "task-trajectory",
          "--task-id",
          "task-1",
          "--participant-id",
          "agent-other",
        ],
        state.runtime,
      ),
      0,
    );
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("Worker message CLI exposes explicit Thread and top-level targets without accepting a Room override", async () => {
  const state = fixture();
  try {
    const base = [
      "worker",
      "message-post",
      "--body",
      "audit",
      "--based-on-room-seq",
      "7",
      "--idempotency-key",
      "audit-1",
    ];
    assert.equal(
      await runWorkerCliCommand(
        [...base, "--thread-id", "old-thread"],
        state.runtime,
      ),
      0,
    );
    assert.equal(
      (state.requests[0]?.body as Record<string, unknown>).threadId,
      "old-thread",
    );
    assert.equal(
      await runWorkerCliCommand([...base, "--top-level"], state.runtime),
      0,
    );
    assert.equal(
      (state.requests[1]?.body as Record<string, unknown>).threadId,
      null,
    );
    assert.notEqual(
      await runWorkerCliCommand(
        [...base, "--thread-id", "t", "--top-level"],
        state.runtime,
      ),
      0,
    );
    assert.notEqual(
      await runWorkerCliCommand(
        [...base, "--room-id", "foreign"],
        state.runtime,
      ),
      0,
    );
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("message-post publishes without ending work; only explicit final ends it and drafts retain intent", async () => {
  const state = fixture();
  try {
    const base = ["worker", "message-post", "--body", "answer"];
    assert.equal(await runWorkerCliCommand(base, state.runtime), 0);
    assert.equal(
      (state.requests[0]?.body as Record<string, unknown>).final,
      undefined,
      "publishing alone must not request interruption of unfinished work",
    );
    assert.equal(
      await runWorkerCliCommand([...base, "--final"], state.runtime),
      0,
    );
    assert.equal(
      (state.requests[1]?.body as Record<string, unknown>).final,
      true,
    );
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-post", "--send-draft", "--final"],
        state.runtime,
      ),
      0,
    );
    assert.equal(
      (state.requests[2]?.body as Record<string, unknown>).final,
      true,
    );
    assert.equal(
      await runWorkerCliCommand([...base, "--progress"], state.runtime),
      0,
    );
    assert.equal(
      Object.hasOwn(state.requests[3]?.body as object, "final"),
      false,
    );
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-post", "--send-draft"],
        state.runtime,
      ),
      0,
    );
    assert.equal(
      Object.hasOwn(state.requests[4]?.body as object, "final"),
      false,
      "resend preserves the draft's stored intent",
    );
    const count = state.requests.length;
    for (const flags of [
      ["--final", "--progress"],
      ["--progress", "false"],
      ["--send-draft", "--progress"],
    ]) {
      assert.notEqual(
        await runWorkerCliCommand(
          [
            "worker",
            "message-post",
            ...flags,
            ...(flags.includes("--send-draft") ? [] : ["--body", "x"]),
          ],
          state.runtime,
        ),
        0,
      );
    }
    assert.equal(
      state.requests.length,
      count,
      "invalid intent never reaches the server",
    );
    // A flag, never a value: `--final false` is rejected, not silently final.
    assert.notEqual(
      await runWorkerCliCommand([...base, "--final", "false"], state.runtime),
      0,
    );
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("Freshness hold is an unsuccessful send with executable review and resend guidance", async () => {
  const state = fixture();
  try {
    state.runtime.fetch = async () =>
      new Response(
        JSON.stringify({
          state: "held",
          heldDraftId: "held-original",
          replyIntent: { basedOnRoomSeq: 8, final: false },
          recoveryTarget: "#room:thread-1",
          seenUpToSeq: 12,
          newMessageCount: 3,
          shownMessageCount: 1,
          omittedMessageCount: 2,
          reholdCount: 1,
          continueAnywaySuggested: false,
          newerMessages: [
            {
              actorId: "participant-human",
              roomSeq: 12,
              payload: { body: "Also answer the follow-up" },
            },
          ],
        }),
      );
    const exit = await runWorkerCliCommand(
      ["worker", "message-post", "--body", "Original result"],
      state.runtime,
    );
    assert.equal(exit, 1, "a saved draft is not a successful send");
    // Raft's `writeText`: the human-readable send output is stdout. A model
    // that only captures stdout must still see the hold and its three paths.
    assert.equal(
      state.stderr(),
      [
        "Error: Message held as draft; no target delivery occurred.",
        "Code: SEND_HELD_AS_DRAFT",
        "Retryable: no",
        "Effect: draft_saved",
        "Draft saved: yes",
        "Next action: Review the held context, then update the draft or send the current draft unchanged.",
        "",
      ].join("\n"),
      "stderr carries Raft's renderError block, including the draft-saved answer",
    );
    assert.doesNotMatch(state.stdout(), /"heldDraftId"/u);
    assert.match(state.stdout(), /SEND_HELD_AS_DRAFT/u);
    // Raft's freshness-hold output, ported structurally.
    assert.match(
      state.stdout(),
      /Freshness hold: showing latest 1 of 3 newer messages\./u,
    );
    assert.match(
      state.stdout(),
      /2 earlier same-target messages omitted from this notice and no longer block this action/u,
    );
    assert.match(
      state.stdout(),
      /Saving a draft does not confirm delivery or complete this work\. Review the bounded context shown here, then choose one path\./u,
    );
    assert.match(
      state.stdout(),
      /\[12\] participant-human: Also answer the follow-up/u,
    );
    assert.match(
      state.stdout(),
      /"\$RAH_WORKER_CLI" worker message-post --revise-draft 'held-original' --target '#room:thread-1' <<'RAH_MESSAGE_EOF'/u,
    );
    assert.match(
      state.stdout(),
      /"\$RAH_WORKER_CLI" worker message-post --send-draft --target '#room:thread-1'/u,
    );
    assert.match(
      state.stdout(),
      /If no reply is needed after review, confirm delivery with:/u,
    );
    assert.match(state.stdout(), /"\$RAH_WORKER_CLI" worker message-check\n/u);
    assert.doesNotMatch(state.stdout(), /--anyway/u);
    // Revision names its draft; cursors, keys and the legacy resend flag stay hidden.
    assert.doesNotMatch(state.stdout(), /--context-receipt/u);
    assert.doesNotMatch(state.stdout(), /--held-draft-id/u);
    assert.doesNotMatch(state.stdout(), /--idempotency-key/u);
    assert.doesNotMatch(state.stdout(), /--based-on-room-seq/u);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("repeated holds surface Raft's --anyway paragraph only when the server suggests it", async () => {
  const state = fixture();
  try {
    state.runtime.fetch = async () =>
      new Response(
        JSON.stringify({
          state: "held",
          heldDraftId: "held-again",
          recoveryTarget: "#room",
          seenUpToSeq: 20,
          newMessageCount: 1,
          shownMessageCount: 1,
          omittedMessageCount: 0,
          reholdCount: 3,
          continueAnywaySuggested: true,
          newerMessages: [],
        }),
      );
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-post", "--body", "Original result"],
        state.runtime,
      ),
      1,
    );
    assert.match(
      state.stdout(),
      /Freshness hold: showing latest 1 of 1 newer message\./u,
    );
    assert.doesNotMatch(state.stdout(), /omitted from this notice/u);
    assert.match(
      state.stdout(),
      /If repeated updates keep blocking the same draft and this is still the right reply, you may use:\n {2}"\$RAH_WORKER_CLI" worker message-post --send-draft --anyway --target '#room'/u,
    );
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("Raft-shaped send reads the body from stdin and needs only a target", async () => {
  const state = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-post", "--target", "#ops"],
        {
          ...state.runtime,
          stdin: Readable.from(["The original result\n"]),
        },
      ),
      0,
    );
    assert.deepEqual(state.requests[0]?.body, {
      body: "The original result",
      channel: "#ops",
    });
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("Raft-shaped draft recovery needs only a target and rejects stdin content", async () => {
  const state = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-post", "--send-draft", "--target", "#ops"],
        { ...state.runtime, stdin: Readable.from([]) },
      ),
      0,
    );
    assert.deepEqual(state.requests[0]?.body, {
      channel: "#ops",
      sendDraft: true,
    });
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-post", "--send-draft", "--target", "#ops"],
        { ...state.runtime, stdin: Readable.from(["A revised reply\n"]) },
      ),
      1,
    );
    assert.equal(
      state.requests.length,
      1,
      "a rejected send never reached the server",
    );
    assert.match(
      state.stderr(),
      /--send-draft sends the saved draft unchanged and must not read message content from stdin/u,
    );
    assert.match(
      state.stderr(),
      /"\$RAH_WORKER_CLI" worker message-post --target "#ops"/u,
    );
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("an explicit --body still wins over stdin, and an empty send is refused", async () => {
  const state = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-post", "--target", "#ops", "--body", "Explicit"],
        { ...state.runtime, stdin: Readable.from(["Ignored stdin\n"]) },
      ),
      0,
    );
    assert.equal(
      (state.requests[0]?.body as Record<string, unknown>).body,
      "Explicit",
    );
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-post", "--target", "#ops"],
        {
          ...state.runtime,
          stdin: Readable.from(["   \n"]),
        },
      ),
      1,
    );
    assert.match(state.stderr(), /message content is required/u);
    assert.equal(state.requests.length, 1);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("protocol flags stay accepted pass-throughs on the Raft-shaped send", async () => {
  const state = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "message-post",
          "--target",
          "#ops",
          "--context-receipt",
          "receipt-1",
          "--based-on-room-seq",
          "9",
          "--idempotency-key",
          "explicit-key",
          "--body",
          "Explicit protocol send",
        ],
        state.runtime,
      ),
      0,
    );
    assert.deepEqual(state.requests[0]?.body, {
      basedOnRoomSeq: 9,
      body: "Explicit protocol send",
      channel: "#ops",
      contextReceipt: "receipt-1",
      idempotencyKey: "explicit-key",
    });
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("A possible thread target mismatch is an unsuccessful send offering exactly two paths", async () => {
  const state = fixture();
  try {
    state.runtime.fetch = async () =>
      new Response(
        JSON.stringify({
          activationIds: [],
          state: "target_confirmation_required",
          reason: "thread_context_target_mismatch",
          heldDraftId: "held-confirm",
          parentTarget: "#room",
          threadTarget: "#room:thread-1",
          threadSeq: 12,
        }),
      );
    const exit = await runWorkerCliCommand(
      ["worker", "message-post", "--target", "#room", "--body", "Conclusion"],
      state.runtime,
    );
    assert.equal(exit, 1, "an unconfirmed target is not a successful send");
    // Raft raises this as a `cliError`, so the whole message is stderr
    // (`main.js@30174525`, `@30167899`). Nothing at all reaches stdout.
    assert.equal(state.stdout(), "", "a raised error never writes stdout");
    assert.match(
      state.stderr(),
      /Code: THREAD_CONTEXT_TARGET_CONFIRMATION_REQUIRED/u,
    );
    assert.match(
      state.stderr(),
      /^Error: Possible thread target mismatch: your latest read context under '#room' is '#room:thread-1', but this send targets '#room' top-level\./u,
    );
    assert.match(
      state.stderr(),
      /This guard is intentionally narrow: moving a thread conclusion to the parent channel can be correct, but it is uncommon enough to confirm once\./u,
    );
    assert.match(
      state.stderr(),
      /If this reply belongs in the thread, send the message to the thread target instead:\n {2}"\$RAH_WORKER_CLI" worker message-post --progress --target '#room:thread-1' <<'RAH_MESSAGE_EOF'/u,
    );
    assert.match(
      state.stderr(),
      /If the top-level channel message is intentional, send the saved draft unchanged:\n {2}"\$RAH_WORKER_CLI" worker message-post --send-draft --target '#room'/u,
    );
    // The composition survived, and Raft carries the two paths as the error's
    // `suggestedNextAction`, not as a second copy of the body.
    assert.match(state.stderr(), /\nDraft saved: yes\n/u);
    assert.match(
      state.stderr(),
      /\nNext action: No message was sent\. Send to '#room:thread-1' if this belongs in the thread, or confirm the saved top-level draft with `"\$RAH_WORKER_CLI" worker message-post --send-draft --target '#room'`\.\n$/u,
    );
    assert.doesNotMatch(state.stderr(), /SEND_HELD_AS_DRAFT/u);
    assert.doesNotMatch(state.stderr(), /--held-draft-id/u);
    assert.doesNotMatch(state.stderr(), /--idempotency-key/u);
    assert.doesNotMatch(state.stderr(), /--context-receipt/u);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("a held send with --json writes nothing to stdout and an ok:false envelope to stderr", async () => {
  const state = fixture();
  try {
    const sent: unknown[] = [];
    state.runtime.fetch = async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      sent.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(
        JSON.stringify({
          state: "held",
          heldDraftId: "held-json",
          recoveryTarget: "#room",
          seenUpToSeq: 12,
          newMessageCount: 1,
          shownMessageCount: 0,
          omittedMessageCount: 0,
          reholdCount: 1,
          continueAnywaySuggested: false,
          newerMessages: [],
        }),
      );
    };
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-post", "--json", "--body", "Original result"],
        state.runtime,
      ),
      1,
    );
    // The defect this closes: RAH used to write the held payload to stdout as
    // a success-shaped object, so a `--json` consumer reading stdout alone read
    // "not delivered" as "delivered". Raft writes nothing there.
    assert.equal(state.stdout(), "", "a held send delivers nothing to stdout");
    const envelope = JSON.parse(state.stderr()) as {
      details: { held: { heldDraftId: string } };
      error: {
        code: string;
        correlation_id: null;
        effect: string;
        fault_domain: null;
        layer: null;
        message: string;
        next_action: string;
        retryable: boolean;
      };
      ok: boolean;
    };
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, "SEND_HELD_AS_DRAFT");
    assert.equal(
      envelope.error.message,
      "Message held as draft; no target delivery occurred.",
    );
    assert.equal(envelope.error.retryable, false);
    assert.equal(envelope.error.effect, "draft_saved");
    assert.equal(envelope.error.fault_domain, null);
    assert.equal(envelope.error.layer, null);
    assert.equal(envelope.error.correlation_id, null);
    assert.equal(
      envelope.error.next_action,
      "Review the held context, then update the draft or send the current draft unchanged.",
    );
    assert.equal(envelope.details.held.heldDraftId, "held-json");
    assert.deepEqual(
      sent,
      [{ body: "Original result" }],
      "--json is an output selector, never part of the send request",
    );
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("a send that fails after the draft was saved refuses to direct a resend", async () => {
  const state = fixture();
  try {
    state.runtime.fetch = async () =>
      new Response(
        JSON.stringify({
          error: { code: "internal_error", message: "internal server error" },
        }),
        { status: 500 },
      );
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-post", "--target", "#ops", "--body", "Result"],
        state.runtime,
      ),
      1,
    );
    assert.equal(state.stdout(), "");
    assert.match(
      state.stderr(),
      /^Error: Worker API HTTP 500: internal server error\nCode: SERVER_5XX\n/u,
    );
    assert.match(state.stderr(), /\nDraft saved: yes\n/u);
    // Raft's `markSendFailureDraftSaved` (`main.js@30168709`): the honest state
    // is CANNOT_CONFIRM, reading cannot settle it, and a resend is a decision
    // to accept a duplicate. This is the one guidance whose absence produces
    // duplicate delivery.
    assert.match(state.stderr(), /so the honest state is CANNOT_CONFIRM/u);
    assert.match(state.stderr(), /Reading CANNOT settle this/u);
    assert.match(state.stderr(), /Do not resend on this evidence\./u);
    assert.match(
      state.stderr(),
      /Sending the draft again is a decision by a person to accept a duplicate/u,
    );
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

// S1-b: a server response below 500 that carries the server's own error code
// is a definite pre-commit rejection. The Kernel resolved the target, refused,
// and rolled the transaction back, so nothing was delivered and no draft was
// written. Describing it as UNKNOWN made a real Agent abandon its final answer.
for (const rejection of [
  {
    name: "a 404 unavailable thread target",
    status: 404,
    code: "not_found",
    cliCode: "NOT_FOUND",
    message: "Thread is unavailable or ambiguous in this Room",
  },
  {
    name: "a 409 conflict",
    status: 409,
    code: "conflict",
    cliCode: "conflict",
    message: "channel Thread conflicts with explicit threadId",
  },
  {
    name: "a 422-style invalid request",
    status: 422,
    code: "invalid_request",
    cliCode: "invalid_request",
    message: "request body is invalid",
  },
  {
    name: "a 400 invalid field",
    status: 400,
    code: "invalid_field",
    cliCode: "invalid_field",
    message: "body is invalid",
  },
  {
    name: "a 403 permission refusal",
    status: 403,
    code: "forbidden",
    cliCode: "forbidden",
    message: "not a member of this Room",
  },
  {
    name: "a 409 thread target mismatch",
    status: 409,
    code: "thread_context_target_mismatch",
    cliCode: "thread_context_target_mismatch",
    message: "receipt names another thread",
  },
]) {
  test(`message-post rejected with ${rejection.name} is reported as not sent and correctable`, async () => {
    const state = fixture();
    try {
      state.runtime.fetch = async () =>
        new Response(
          JSON.stringify({
            error: { code: rejection.code, message: rejection.message },
          }),
          { status: rejection.status },
        );
      assert.equal(
        await runWorkerCliCommand(
          [
            "worker",
            "message-post",
            "--target",
            "#ops:deadbeef",
            "--body",
            "Final answer",
          ],
          state.runtime,
        ),
        1,
      );
      assert.equal(state.stdout(), "");
      const stderr = state.stderr();
      assert.equal(
        stderr,
        [
          `Error: Worker API HTTP ${String(rejection.status)}: ${rejection.message}`,
          `Code: ${rejection.cliCode}`,
          "Retryable: no",
          "Effect: not_sent",
          "Draft saved: no",
          `Next action: ${SEND_REJECTED_NEXT_ACTION}`,
          "",
        ].join("\n"),
      );
      assert.doesNotMatch(stderr, /UNKNOWN|CANNOT_CONFIRM|Do not resend/u);
      assert.match(SEND_REJECTED_NEXT_ACTION, /rejected/u);
      assert.match(SEND_REJECTED_NEXT_ACTION, /nothing was sent/u);
      assert.match(SEND_REJECTED_NEXT_ACTION, /saved no new draft/u);
      assert.match(SEND_REJECTED_NEXT_ACTION, /target/u);
      assert.match(SEND_REJECTED_NEXT_ACTION, /send again/u);
    } finally {
      rmSync(state.directory, { force: true, recursive: true });
    }
  });
}

// P2-2: an idempotency conflict is not a clean rejection. A message under
// that identity may already be committed, so the CLI must neither claim
// not_sent nor invite a resend under a new key.
test("message-post refused for an idempotency conflict does not claim not_sent", async () => {
  const state = fixture();
  try {
    state.runtime.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "idempotency_conflict",
            message: "idempotency key k was already used for another mutation",
          },
        }),
        { status: 409 },
      );
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-post", "--target", "#ops", "--body", "Result"],
        state.runtime,
      ),
      1,
    );
    const stderr = state.stderr();
    assert.equal(
      stderr,
      [
        "Error: Worker API HTTP 409: idempotency key k was already used for another mutation",
        "Code: idempotency_conflict",
        "Retryable: no",
        "Effect: may_already_exist",
        "Draft saved: no",
        `Next action: ${SEND_IDEMPOTENCY_CONFLICT_NEXT_ACTION}`,
        "",
      ].join("\n"),
    );
    assert.doesNotMatch(stderr, /not_sent|cannot duplicate|send again/u);
    assert.match(SEND_IDEMPOTENCY_CONFLICT_NEXT_ACTION, /may already/u);
    assert.match(SEND_IDEMPOTENCY_CONFLICT_NEXT_ACTION, /idempotency/u);
    assert.match(SEND_IDEMPOTENCY_CONFLICT_NEXT_ACTION, /message-read/u);
    assert.match(SEND_IDEMPOTENCY_CONFLICT_NEXT_ACTION, /new key/u);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("a coded rejection outside the definite families keeps CANNOT_CONFIRM", async () => {
  const state = fixture();
  try {
    state.runtime.fetch = async () =>
      new Response(
        JSON.stringify({
          error: { code: "execution_fenced", message: "not current" },
        }),
        { status: 409 },
      );
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-post", "--target", "#ops", "--body", "Result"],
        state.runtime,
      ),
      1,
    );
    assert.doesNotMatch(state.stderr(), /not_sent/u);
    assert.match(state.stderr(), /\nDraft saved: yes\n/u);
    assert.match(state.stderr(), /CANNOT_CONFIRM/u);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("a rejected message-post under --json keeps the text block and states not_sent", async () => {
  const state = fixture();
  try {
    state.runtime.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "not_found",
            message: "Thread is unavailable or ambiguous in this Room",
          },
        }),
        { status: 404 },
      );
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-post", "--json", "--body", "Final answer"],
        state.runtime,
      ),
      1,
    );
    // Server errors keep Raft's text renderError block even under --json.
    assert.match(state.stderr(), /\nEffect: not_sent\nDraft saved: no\n/u);
    assert.doesNotMatch(state.stderr(), /CANNOT_CONFIRM/u);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("a rejected message-post keeps the server's own next action when it has one", async () => {
  const state = fixture();
  try {
    state.runtime.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "forbidden",
            message: "not a member",
            suggestedNextAction: "Ask the Human to add you to this Room.",
          },
        }),
        { status: 403 },
      );
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-post", "--target", "#ops", "--body", "Result"],
        state.runtime,
      ),
      1,
    );
    assert.match(state.stderr(), /\nEffect: not_sent\n/u);
    assert.match(state.stderr(), /\nDraft saved: no\n/u);
    assert.match(
      state.stderr(),
      /\nNext action: Ask the Human to add you to this Room\.\n$/u,
    );
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("a transport failure during message-post stays UNKNOWN / CANNOT_CONFIRM", async () => {
  const state = fixture();
  try {
    state.runtime.fetch = async () => {
      throw new TypeError("fetch failed: ECONNRESET");
    };
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-post", "--target", "#ops", "--body", "Result"],
        state.runtime,
      ),
      1,
    );
    assert.match(state.stderr(), /\nDraft saved: yes\n/u);
    assert.match(state.stderr(), /so the honest state is CANNOT_CONFIRM/u);
    assert.doesNotMatch(state.stderr(), /not_sent/u);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("a 4xx without a server error code is not treated as a definite rejection", async () => {
  const state = fixture();
  try {
    state.runtime.fetch = async () =>
      new Response("<html>bad gateway-ish proxy page</html>", { status: 404 });
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-post", "--target", "#ops", "--body", "Result"],
        state.runtime,
      ),
      1,
    );
    assert.doesNotMatch(state.stderr(), /not_sent/u);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("a failed --send-draft saves no new draft and carries no CANNOT_CONFIRM guidance", async () => {
  const state = fixture();
  try {
    state.runtime.fetch = async () =>
      new Response(
        JSON.stringify({
          error: { code: "not_found", message: "no draft for this target" },
        }),
        { status: 404 },
      );
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-post", "--send-draft", "--target", "#ops"],
        { ...state.runtime, stdin: Readable.from([]) },
      ),
      1,
    );
    assert.match(
      state.stderr(),
      // S1-b: a coded 404 is a definite rejection, so it now also states
      // that nothing was sent and how to recover, instead of staying silent.
      /^Error: Worker API HTTP 404: no draft for this target\nCode: NOT_FOUND\nRetryable: no\nEffect: not_sent\nDraft saved: no\nNext action: The server rejected this send before committing it/u,
      state.stderr(),
    );
    assert.doesNotMatch(state.stderr(), /CANNOT_CONFIRM/u);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("a server error surfaces its stable code and the server's next action", async () => {
  const state = fixture();
  try {
    state.runtime.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "not_found",
            message: "message is unavailable",
            suggestedNextAction: WORKER_MESSAGE_RESOLVE_NOT_FOUND_NEXT_ACTION,
          },
        }),
        { status: 404 },
      );
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "message-resolve",
          "--message-id",
          "11111111-1111-4111-8111-111111111111",
        ],
        state.runtime,
      ),
      1,
    );
    assert.equal(state.stdout(), "", "a raised error never writes stdout");
    assert.equal(
      state.stderr(),
      [
        "Error: Worker API HTTP 404: message is unavailable",
        "Code: NOT_FOUND",
        `Next action: ${WORKER_MESSAGE_RESOLVE_NOT_FOUND_NEXT_ACTION}`,
        "",
      ].join("\n"),
      "the server's stable code and its recovery guidance both reach the Agent",
    );
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

/**
 * Raft sets `outputMode` from `opts.json` at exactly two sites — the held send
 * and mention partial delivery — so an API failure renders the text block even
 * under `--json` (`main.js` `apiFailureError` passes no `outputMode`). RAH
 * replicates that rather than inventing a wider JSON error surface.
 */
test("a server error under --json keeps Raft's text error block on stderr", async () => {
  const state = fixture();
  try {
    state.runtime.fetch = async () =>
      new Response(
        JSON.stringify({
          error: { code: "forbidden", message: "target is not joined" },
        }),
        { status: 403 },
      );
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-post", "--json", "--target", "#ops", "--body", "x"],
        state.runtime,
      ),
      1,
    );
    assert.equal(state.stdout(), "");
    assert.match(
      state.stderr(),
      /^Error: Worker API HTTP 403: target is not joined\nCode: forbidden\n/u,
    );
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("a successful send does not invent a thread from a message id", async () => {
  const state = fixture();
  try {
    state.runtime.fetch = async () =>
      new Response(
        JSON.stringify({
          activationIds: [],
          deduplicated: false,
          event: { aggregateId: "message_ab12cd34ef56", roomSeq: 9 },
        }),
      );
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-post", "--target", "#ops", "--body", "Done"],
        state.runtime,
      ),
      0,
    );
    assert.equal(
      state.stdout(),
      "Message sent to #ops. Message ID: message_ab12cd34ef56\n",
    );
    assert.equal(state.stderr(), "");
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("a send to a thread target repeats that target and adds no second hint", async () => {
  const state = fixture();
  try {
    state.runtime.fetch = async () =>
      new Response(
        JSON.stringify({
          activationIds: [],
          deduplicated: false,
          event: { aggregateId: "message_ffffffff0000", roomSeq: 10 },
        }),
      );
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "message-post",
          "--target",
          "#ops:thread-1",
          "--body",
          "Done",
        ],
        state.runtime,
      ),
      0,
    );
    assert.equal(
      state.stdout(),
      "Message sent to #ops:thread-1. Message ID: message_ffffffff0000\n",
    );
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("replacing an unsent draft warns on stderr with Raft's wording and flags it on stdout", async () => {
  const state = fixture();
  try {
    state.runtime.fetch = async () =>
      new Response(
        JSON.stringify({
          activationIds: [],
          deduplicated: false,
          event: { aggregateId: "message_1234567890ab", roomSeq: 11 },
          replacedDraft: { body: "F0909G BUSY DONE" },
        }),
      );
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "message-post",
          "--target",
          "#agent-council",
          "--body",
          "F0909G FOLLOWUP DONE",
        ],
        state.runtime,
      ),
      0,
    );
    assert.equal(
      state.stderr(),
      [
        "Warning: replacing an unsent draft for #agent-council.",
        "One draft is kept per target, so the previous body is now discarded.",
        "Discarded draft (last copy):",
        "F0909G BUSY DONE",
        "",
      ].join("\n"),
    );
    // RAH adaptation: a model that never captures stderr still learns it.
    assert.match(
      state.stdout(),
      /^Warning: replaced an unsent draft for #agent-council; see stderr for the discarded body\.\n/u,
    );
    assert.match(state.stdout(), /Message sent to #agent-council\./u);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("a long discarded draft is truncated at the excerpt limit", async () => {
  const state = fixture();
  try {
    const long = "x".repeat(450);
    state.runtime.fetch = async () =>
      new Response(
        JSON.stringify({
          state: "held",
          heldDraftId: "held-replace",
          recoveryTarget: "#room",
          seenUpToSeq: 12,
          newMessageCount: 1,
          shownMessageCount: 0,
          omittedMessageCount: 0,
          reholdCount: 1,
          continueAnywaySuggested: false,
          newerMessages: [],
          replacedDraft: { body: `  ${long}  ` },
        }),
      );
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-post", "--target", "#room", "--body", "Revised"],
        state.runtime,
      ),
      1,
    );
    assert.match(
      state.stderr(),
      /^Warning: replacing an unsent draft for #room\.\n/u,
    );
    assert.ok(
      state
        .stderr()
        .includes(`${"x".repeat(400)}… (450 chars total, truncated)`),
      state.stderr(),
    );
    assert.match(state.stderr(), /Code: SEND_HELD_AS_DRAFT/u);
    assert.match(
      state.stdout(),
      /^Warning: replaced an unsent draft for #room; see stderr for the discarded body\.\n/u,
    );
    assert.match(state.stdout(), /SEND_HELD_AS_DRAFT/u);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

/**
 * Raft has neither `--based-on-room-seq` nor `--idempotency-key` on any Task
 * command. RAH's Task family therefore sends the minimal body, and the two
 * flags stay accepted pass-throughs.
 */
const minimalTaskCommands: ReadonlyArray<{
  argv: readonly string[];
  body: Record<string, unknown>;
  path: string;
}> = [
  {
    argv: ["task-claim", "--task-id", "task-1"],
    body: { taskId: "task-1" },
    path: "/v1/worker/tasks/claim",
  },
  {
    argv: ["task-start", "--task-id", "task-1"],
    body: { taskId: "task-1" },
    path: "/v1/worker/tasks/start",
  },
  {
    argv: ["task-release", "--task-id", "task-1"],
    body: { taskId: "task-1" },
    path: "/v1/worker/tasks/release",
  },
  {
    argv: ["task-progress", "--task-id", "task-1", "--progress", "half way"],
    body: { progress: "half way", taskId: "task-1" },
    path: "/v1/worker/tasks/progress",
  },
  {
    argv: ["task-block", "--task-id", "task-1", "--reason", "waiting"],
    body: { reason: "waiting", taskId: "task-1" },
    path: "/v1/worker/tasks/block",
  },
  {
    argv: ["task-request-input", "--task-id", "task-1", "--question", "which?"],
    body: { question: "which?", taskId: "task-1" },
    path: "/v1/worker/tasks/request-input",
  },
  {
    argv: ["task-submit", "--task-id", "task-1", "--summary", "done"],
    body: { summary: "done", taskId: "task-1" },
    path: "/v1/worker/tasks/submit",
  },
  {
    argv: [
      "task-review",
      "--task-id",
      "task-1",
      "--disposition",
      "approved",
      "--summary",
      "evidence read",
    ],
    body: {
      disposition: "approved",
      summary: "evidence read",
      taskId: "task-1",
    },
    path: "/v1/worker/tasks/review",
  },
  {
    argv: [
      "task-claim-message",
      "--message-id",
      "message-1",
      "--rationale",
      "durable work",
    ],
    body: { messageId: "message-1", rationale: "durable work" },
    path: "/v1/worker/tasks/claim-message",
  },
  {
    argv: ["task-create", "--title", "New work"],
    body: { title: "New work" },
    path: "/v1/worker/tasks/create",
  },
  {
    argv: ["task-assign", "--task-id", "task-1", "--assignee", "agent-2"],
    body: { assigneeId: "agent-2", taskId: "task-1" },
    path: "/v1/worker/tasks/assign",
  },
  {
    argv: ["task-amend", "--task-id", "task-1", "--title", "Sharper title"],
    body: { taskId: "task-1", title: "Sharper title" },
    path: "/v1/worker/tasks/amend",
  },
  {
    argv: ["task-unblock", "--task-id", "task-1"],
    body: { taskId: "task-1" },
    path: "/v1/worker/tasks/unblock",
  },
  {
    argv: ["task-convert", "--message-id", "message-1"],
    body: { messageId: "message-1" },
    path: "/v1/worker/tasks/convert",
  },
  {
    argv: ["task-delete", "--room-id", "room-1", "--task-id", "task-1"],
    body: { roomId: "room-1", taskId: "task-1" },
    path: "/v1/worker/tasks/delete",
  },
];

test("every Task command sends the Raft-shaped minimal body", async () => {
  for (const command of minimalTaskCommands) {
    const state = fixture();
    try {
      assert.equal(
        await runWorkerCliCommand(["worker", ...command.argv], state.runtime),
        0,
        command.argv[0],
      );
      assert.deepEqual(state.requests[0]?.body, command.body, command.argv[0]);
      assert.equal(
        state.requests[0]?.url,
        `http://127.0.0.1:43123${command.path}`,
      );
    } finally {
      rmSync(state.directory, { force: true, recursive: true });
    }
  }
});

test("the explicit causal form stays an accepted pass-through on every Task command", async () => {
  for (const command of minimalTaskCommands) {
    const state = fixture();
    try {
      assert.equal(
        await runWorkerCliCommand(
          [
            "worker",
            ...command.argv,
            "--based-on-room-seq",
            "9",
            "--idempotency-key",
            "explicit-key",
          ],
          state.runtime,
        ),
        0,
        command.argv[0],
      );
      assert.deepEqual(
        state.requests[0]?.body,
        { ...command.body, basedOnRoomSeq: 9, idempotencyKey: "explicit-key" },
        command.argv[0],
      );
    } finally {
      rmSync(state.directory, { force: true, recursive: true });
    }
  }
});

test("help no longer presents the causal parameters as required on Task commands", async () => {
  const state = fixture();
  try {
    await runWorkerCliCommand(["worker", "help"], state.runtime);
    const help = state.stdout();
    for (const line of help.split("\n"))
      if (/^"\$RAH_WORKER_CLI" worker task-/u.test(line))
        assert.ok(
          !line.includes("--based-on-room-seq") &&
            !line.includes("--idempotency-key"),
          line,
        );
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

/**
 * Raft addresses a Task as a Human reads it — `--target "#channel" --number N`
 * (agent-prompt-compiler.js line 181) — with `--channel` as the legacy alias.
 */
const numberAddressedTaskCommands: ReadonlyArray<{
  argv: readonly string[];
  body: Record<string, unknown>;
  path: string;
}> = [
  {
    argv: ["task-get"],
    body: { channel: "#build", taskNumber: 3 },
    path: "/v1/worker/tasks/get",
  },
  {
    argv: ["task-submission"],
    body: { channel: "#build", taskNumber: 3 },
    path: "/v1/worker/tasks/submission",
  },
  {
    argv: ["task-input-status"],
    body: { channel: "#build", taskNumber: 3 },
    path: "/v1/worker/tasks/input-status",
  },
  {
    argv: ["task-trajectory"],
    body: { channel: "#build", taskNumber: 3 },
    path: "/v1/worker/tasks/trajectory",
  },
  {
    argv: ["task-claim"],
    body: { channel: "#build", taskNumber: 3 },
    path: "/v1/worker/tasks/claim",
  },
  {
    argv: ["task-start"],
    body: { channel: "#build", taskNumber: 3 },
    path: "/v1/worker/tasks/start",
  },
  {
    argv: ["task-release"],
    body: { channel: "#build", taskNumber: 3 },
    path: "/v1/worker/tasks/release",
  },
  {
    argv: ["task-progress", "--progress", "half way"],
    body: { channel: "#build", progress: "half way", taskNumber: 3 },
    path: "/v1/worker/tasks/progress",
  },
  {
    argv: ["task-block", "--reason", "waiting"],
    body: { channel: "#build", reason: "waiting", taskNumber: 3 },
    path: "/v1/worker/tasks/block",
  },
  {
    argv: ["task-request-input", "--question", "which?"],
    body: { channel: "#build", question: "which?", taskNumber: 3 },
    path: "/v1/worker/tasks/request-input",
  },
  {
    argv: ["task-submit", "--summary", "done"],
    body: { channel: "#build", summary: "done", taskNumber: 3 },
    path: "/v1/worker/tasks/submit",
  },
  {
    argv: [
      "task-review",
      "--disposition",
      "approved",
      "--summary",
      "evidence read",
    ],
    body: {
      channel: "#build",
      disposition: "approved",
      summary: "evidence read",
      taskNumber: 3,
    },
    path: "/v1/worker/tasks/review",
  },
  {
    argv: ["task-assign", "--assignee", "agent-2"],
    body: { assigneeId: "agent-2", channel: "#build", taskNumber: 3 },
    path: "/v1/worker/tasks/assign",
  },
  {
    argv: ["task-amend", "--title", "Sharper title"],
    body: { channel: "#build", taskNumber: 3, title: "Sharper title" },
    path: "/v1/worker/tasks/amend",
  },
  {
    argv: ["task-unblock"],
    body: { channel: "#build", taskNumber: 3 },
    path: "/v1/worker/tasks/unblock",
  },
  {
    argv: ["task-delete"],
    body: { channel: "#build", taskNumber: 3 },
    path: "/v1/worker/tasks/delete",
  },
];

test("every Task command accepts Raft's --target with --number addressing", async () => {
  for (const command of numberAddressedTaskCommands) {
    for (const alias of ["--target", "--channel"]) {
      const state = fixture();
      try {
        assert.equal(
          await runWorkerCliCommand(
            [
              "worker",
              command.argv[0]!,
              alias,
              "#build",
              "--number",
              "3",
              ...command.argv.slice(1),
            ],
            state.runtime,
          ),
          0,
          `${command.argv[0]!} ${alias}: ${state.stderr()}`,
        );
        assert.deepEqual(
          state.requests[0]?.body,
          command.body,
          command.argv[0],
        );
        assert.equal(
          state.requests[0]?.url,
          `http://127.0.0.1:43123${command.path}`,
        );
      } finally {
        rmSync(state.directory, { force: true, recursive: true });
      }
    }
  }
});

test("--number repeats on task-claim alone and submits one batch", async () => {
  const state = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "task-claim",
          "--target",
          "#build",
          "--number",
          "1",
          "--number",
          "2",
        ],
        state.runtime,
      ),
      0,
      state.stderr(),
    );
    assert.deepEqual(
      state.requests.map((request) => request.body),
      [{ channel: "#build", taskNumbers: [1, 2] }],
    );
    // Raft writes one `formatClaimResults` block for the whole claim, not one
    // machine line per request.
    assert.match(state.stdout(), /^Claim results \(2 claimed\):\n/u);
    assert.equal(state.stdout().match(/: claimed$/gmu)?.length, 2);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }

  const single = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "task-start",
          "--target",
          "#build",
          "--number",
          "1",
          "--number",
          "2",
        ],
        single.runtime,
      ),
      1,
    );
    assert.match(single.stderr(), /duplicate Worker option: --number/u);
  } finally {
    rmSync(single.directory, { force: true, recursive: true });
  }
});

test("the two addressing forms are mutually exclusive and each is complete", async () => {
  const cases: ReadonlyArray<[readonly string[], RegExp]> = [
    [
      ["task-start", "--task-id", "task-1", "--number", "3"],
      /choose --task-id or --target with --number/u,
    ],
    [["task-start", "--number", "3"], /address the Task with --target/u],
    [["task-start", "--target", "#build"], /address the Task with --target/u],
    [["task-start"], /address the Task with --target/u],
    [
      [
        "task-start",
        "--target",
        "#build",
        "--channel",
        "#build",
        "--number",
        "3",
      ],
      /choose --target or --channel/u,
    ],
    [
      ["task-start", "--target", "#build", "--number", "0"],
      /--number must be a positive integer/u,
    ],
    [
      ["task-start", "--target", "#build", "--number", "one"],
      /--number must be a positive integer/u,
    ],
  ];
  for (const [argv, expected] of cases) {
    const state = fixture();
    try {
      assert.equal(
        await runWorkerCliCommand(["worker", ...argv], state.runtime),
        1,
        argv.join(" "),
      );
      assert.match(state.stderr(), expected, argv.join(" "));
      assert.equal(state.requests.length, 0);
    } finally {
      rmSync(state.directory, { force: true, recursive: true });
    }
  }
});

/**
 * Raft's minimal forms for the commands this batch ported. Each one is the
 * shape the extracted Computer CLI actually offers the model; the explicit RAH
 * form is asserted alongside so both are known to resolve to one request.
 */
test("Worker CLI offers Raft's minimal form for react, unfollow, mute, delete, profile and attachments", async () => {
  const state = fixture();
  try {
    const run = async (args: string[]) =>
      runWorkerCliCommand(args, state.runtime);
    assert.equal(
      await run([
        "worker",
        "message-react",
        "--message-id",
        "msg-1",
        "--emoji",
        "👍",
      ]),
      0,
      state.stderr(),
    );
    assert.deepEqual(state.requests.at(-1)?.body, {
      messageId: "msg-1",
      emoji: "👍",
      active: true,
    });
    // Raft's `--remove` is the other side of the same toggle.
    assert.equal(
      await run([
        "worker",
        "message-react",
        "--message-id",
        "msg-1",
        "--emoji",
        "👍",
        "--remove",
      ]),
      0,
      state.stderr(),
    );
    assert.equal((state.requests.at(-1)?.body as any).active, false);
    assert.equal(
      await run([
        "worker",
        "message-react",
        "--message-id",
        "msg-1",
        "--emoji",
        "👍",
        "--remove",
        "--active",
        "true",
      ]),
      1,
      "--remove and --active are the same toggle and cannot disagree",
    );

    assert.equal(
      await run([
        "worker",
        "thread-unfollow",
        "--target",
        "#channel:abcd1234",
        "--reason",
        "handled elsewhere",
      ]),
      0,
      state.stderr(),
    );
    assert.deepEqual(state.requests.at(-1)?.body, {
      reason: "handled elsewhere",
      channel: "#channel:abcd1234",
    });

    for (const command of ["channel-mute", "channel-unmute"]) {
      assert.equal(
        await run(["worker", command, "--target", "#channel"]),
        0,
        state.stderr(),
      );
      assert.deepEqual(state.requests.at(-1)?.body, { channel: "#channel" });
      assert.equal(await run(["worker", command]), 0, state.stderr());
      assert.deepEqual(state.requests.at(-1)?.body, {});
    }

    assert.equal(
      await run(["worker", "task-delete", "--task-id", "task-1"]),
      0,
      state.stderr(),
    );
    assert.deepEqual(state.requests.at(-1)?.body, { taskId: "task-1" });

    assert.equal(
      await run(["worker", "profile-update", "--display-name", "Visible name"]),
      0,
      state.stderr(),
    );
    assert.deepEqual(state.requests.at(-1)?.body, {
      patch: { displayName: "Visible name" },
    });

    assert.equal(
      await run(["worker", "room-read", "--target", "#channel"]),
      0,
      state.stderr(),
    );
    assert.deepEqual(state.requests.at(-1)?.body, {
      channel: "#channel",
      limit: 50,
    });
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("the CLI help never asks the Agent for a cursor, a key or a paging receipt", () => {
  const state = fixture();
  try {
    return runWorkerCliCommand(["worker", "--help"], state.runtime).then(() => {
      const help = state.stdout();
      for (const command of [
        "message-react --message-id ID --emoji EMOJI [--remove]",
        'thread-unfollow --target "#channel:THREAD_ID" [--reason TEXT]',
        "channel-mute [--target #CHANNEL]",
        "channel-unmute [--target #CHANNEL]",
        "task-delete TASK",
        "room-read --target TARGET [--limit N]",
      ])
        assert.ok(help.includes(command), command);
      for (const line of help.split("\n")) {
        // `artifact-publish` keeps its explicit key, and a target attachment
        // still names the receipt its complete target read issued; neither row
        // is part of this batch.
        if (
          line.startsWith('"$RAH_WORKER_CLI" worker artifact-publish') ||
          line.startsWith('"$RAH_WORKER_CLI" worker attachment-publish')
        )
          continue;
        assert.ok(
          !line.includes("--based-on-room-seq") &&
            !line.includes("--idempotency-key") &&
            !line.includes("--context-receipt") &&
            !line.includes("--control-room-id") &&
            !line.includes("--expected-revision-id"),
          line,
        );
      }
    });
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("help states explicit delivery acknowledgement and artifact key exceptions", async () => {
  const state = fixture();
  try {
    await runWorkerCliCommand(["worker", "help"], state.runtime);
    const help = state.stdout();
    assert.ok(
      !help.includes("No command needs a causal cursor or an idempotency key"),
    );
    assert.ok(help.includes("message-check drains the current Activation"));
    assert.ok(help.includes("Artifact publication derives its retry identity"));
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("normal message-check hides cursors and acknowledges only rendered delivery", async () => {
  const state = fixture();
  try {
    const calls: Array<{ path: string; body: unknown }> = [];
    const code = await runWorkerCliCommand(["worker", "message-check"], {
      ...state.runtime,
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname;
        calls.push({ path, body: JSON.parse(String(init?.body)) });
        return new Response(
          JSON.stringify(
            path.endsWith("message-check")
              ? {
                  throughSeq: 7,
                  delivery: {
                    cursorBefore: 0,
                    cursorAfter: 7,
                    latestRoomSeq: 12,
                    events: [],
                    snapshot: null,
                  },
                }
              : { acknowledgedThrough: 7 },
          ),
        );
      },
    });
    assert.equal(code, 0, state.stderr());
    assert.deepEqual(calls, [
      { path: "/v1/worker/message-check", body: {} },
      { path: "/v1/worker/acknowledge", body: { throughSeq: 7 } },
    ]);
    assert.match(state.stdout(), /current Activation/);
    assert.doesNotMatch(state.stdout(), /through-seq/);
  } finally {
    rmSync(state.directory, { recursive: true, force: true });
  }
});

test("Worker CLI owns Artifact retry keys without sending a local path", async () => {
  const state = fixture();
  const filePath = join(state.directory, "evidence.txt");
  writeFileSync(filePath, "artifact-evidence!", { mode: 0o600 });
  const requests: Array<{
    body: string;
    headers: Headers;
    method: string | undefined;
    url: string;
  }> = [];
  try {
    const publish = () =>
      runWorkerCliCommand(
        [
          "worker",
          "artifact-publish",
          "--task-id",
          "task-1",
          "--path",
          filePath,
          "--mime-type",
          "text/plain",
        ],
        {
          ...state.runtime,
          env: { ...state.runtime.env, RAH_RUN_ATTEMPT_ID: "run-1" },
          fetch: async (input, init) => {
            const body =
              typeof init?.body === "string"
                ? init.body
                : Buffer.from(
                    await new Response(init?.body ?? null).arrayBuffer(),
                  ).toString("utf8");
            requests.push({
              body,
              headers: new Headers(init?.headers),
              method: init?.method,
              url: String(input),
            });
            return String(input).endsWith("/prepare")
              ? new Response(
                  JSON.stringify({
                    attachmentId: "attachment-1",
                    expiresAt: "2026-09-01T01:00:00.000Z",
                    filename: "evidence.txt",
                    mimeType: "text/plain",
                    roomId: "room-1",
                    size: 18,
                    state: "pending",
                    taskId: "task-1",
                  }),
                )
              : new Response(
                  JSON.stringify({
                    attachmentId: "attachment-1",
                    expiresAt: "2026-09-01T01:00:00.000Z",
                    filename: "evidence.txt",
                    mimeType: "text/plain",
                    roomId: "room-1",
                    sha256:
                      "0d612265f5b74df4d813cf768c288f6dc27872470cd02e763c130b0bdaafbe51",
                    size: 18,
                    state: "completed",
                    taskId: "task-1",
                  }),
                );
          },
        },
      );
    assert.equal(await publish(), 0, state.stderr());
    assert.equal(requests.length, 2);
    assert.equal(
      requests[0]?.url,
      "http://127.0.0.1:43123/v1/worker/artifacts/prepare",
    );
    assert.match(
      JSON.parse(requests[0]!.body).idempotencyKey,
      /^artifact:[a-f0-9]{64}$/,
    );
    assert.deepEqual(
      { ...JSON.parse(requests[0]!.body), idempotencyKey: "automatic" },
      {
        filename: "evidence.txt",
        idempotencyKey: "automatic",
        mimeType: "text/plain",
        size: 18,
        taskId: "task-1",
      },
    );
    assert.equal(requests[0]?.body.includes(filePath), false);
    assert.equal(requests[1]?.method, "PUT");
    assert.equal(
      requests[1]?.url,
      "http://127.0.0.1:43123/v1/worker/artifacts/attachment-1",
    );
    assert.equal(requests[1]?.body, "artifact-evidence!");
    assert.equal(await publish(), 0, state.stderr());
    assert.equal(
      JSON.parse(requests[2]!.body).idempotencyKey,
      JSON.parse(requests[0]!.body).idempotencyKey,
      "same logical retry must reuse its preparation key",
    );
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("message-check accepts the full sync budget plus its bounded outer envelope", async () => {
  const state = fixture();
  try {
    const delivery = {
      cursorBefore: 0,
      cursorAfter: 1,
      latestRoomSeq: 1,
      snapshot: null,
      events: [
        {
          eventId: "event-1",
          roomId: "room-1",
          roomSeq: 1,
          type: "message.posted",
          actorId: "agent-1",
          aggregateType: "message",
          aggregateId: "message-1",
          payload: { body: "" },
          idempotencyKey: "key-1",
          schemaVersion: 1,
          createdAt: "2026-09-11T00:00:00.000Z",
        },
      ],
    };
    delivery.events[0]!.payload.body = "x".repeat(
      2 * 1024 * 1024 - Buffer.byteLength(JSON.stringify(delivery)),
    );
    assert.equal(Buffer.byteLength(JSON.stringify(delivery)), 2 * 1024 * 1024);
    let acknowledged = false;
    const code = await runWorkerCliCommand(["worker", "message-check"], {
      ...state.runtime,
      fetch: async (input) => {
        if (String(input).endsWith("acknowledge")) {
          acknowledged = true;
          return new Response(JSON.stringify({ acknowledgedThrough: 1 }));
        }
        return new Response(JSON.stringify({ delivery, throughSeq: 1 }));
      },
    });
    assert.equal(code, 0, state.stderr());
    assert.equal(acknowledged, true);
  } finally {
    rmSync(state.directory, { recursive: true, force: true });
  }
});

test("explicit draft revision sends new text and an exact draft identity without a new ACK marker", async () => {
  const f = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "message-post",
          "--target",
          "#main",
          "--revise-draft",
          "draft-1",
          "--body",
          "revised",
        ],
        f.runtime,
      ),
      0,
    );
    assert.deepEqual(f.requests[0]!.body, {
      channel: "#main",
      reviseDraftId: "draft-1",
      body: "revised",
    });
    for (const extra of [
      ["--based-on-room-seq", "99"],
      ["--final"],
      ["--progress"],
      ["--send-draft"],
      ["--anyway"],
      ["--attachment-ids", "file-1"],
    ]) {
      const before = f.requests.length;
      assert.notEqual(
        await runWorkerCliCommand(
          [
            "worker",
            "message-post",
            "--target",
            "#main",
            "--revise-draft",
            "draft-1",
            "--body",
            "revised",
            ...extra,
          ],
          f.runtime,
        ),
        0,
      );
      assert.equal(
        f.requests.length,
        before,
        "conflicting revision arguments never reach the server",
      );
    }
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});
