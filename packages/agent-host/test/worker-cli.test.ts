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

import { runWorkerCliCommand } from "../src/index.ts";

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
    assert.equal(state.stdout(), '{"ok":true,"roomSeq":7}\n');
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

test("Worker CLI exposes managed MCP catalog and version-fenced calls without routing fields", async () => {
  const state = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(["worker", "mcp-tools"], state.runtime),
      0,
    );
    assert.deepEqual(state.requests[0]?.body, {});
    assert.equal(
      state.requests[0]?.url,
      "http://127.0.0.1:43123/v1/worker/mcp/tools",
    );
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "mcp-call",
          "--server-id",
          "mcp-room-tools",
          "--tool-name",
          "room.snapshot",
          "--config-version",
          "7",
          "--assignment-version",
          "3",
          "--arguments-json",
          '{"roomId":"room-1"}',
        ],
        state.runtime,
      ),
      0,
    );
    assert.deepEqual(state.requests[1]?.body, {
      arguments: { roomId: "room-1" },
      expectedAssignmentVersion: 3,
      expectedConfigVersion: 7,
      mcpServerId: "mcp-room-tools",
      toolName: "room.snapshot",
    });
    assert.equal(
      state.requests[1]?.url,
      "http://127.0.0.1:43123/v1/worker/mcp/call",
    );
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "mcp-call",
          "--server-id",
          "mcp-room-tools",
          "--tool-name",
          "room.snapshot",
          "--config-version",
          "7",
          "--assignment-version",
          "3",
          "--arguments-json",
          "[]",
        ],
        state.runtime,
      ),
      1,
    );
    assert.equal(state.requests.length, 2);
    assert.match(state.stderr(), /JSON object/u);
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

test("Worker CLI cancels an oversized response without exposing its credential", async () => {
  const state = fixture();
  let cancelled = false;
  try {
    const responseBody = new ReadableStream<Uint8Array>({
      cancel: () => {
        cancelled = true;
      },
      start: (controller) => {
        controller.enqueue(new Uint8Array(512 * 1_024 + 1));
      },
    });
    assert.equal(
      await runWorkerCliCommand(["worker", "sync"], {
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
});
