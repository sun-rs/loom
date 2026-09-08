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

test("Freshness hold is an unsuccessful send with executable review and resend guidance", async () => {
  const state = fixture();
  try {
    state.runtime.fetch = async () =>
      new Response(
        JSON.stringify({
          state: "held",
          heldDraftId: "held-original",
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
      "Error: Message held as draft; no target delivery occurred.\nCode: SEND_HELD_AS_DRAFT\n",
      "stderr carries only the short renderError summary",
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
      /Your message has been saved as a draft\. Review the bounded context shown here, then choose one path\./u,
    );
    assert.match(
      state.stdout(),
      /\[12\] participant-human: Also answer the follow-up/u,
    );
    assert.match(
      state.stdout(),
      /rah worker message-post --target '#room:thread-1' <<'RAH_MESSAGE_EOF'/u,
    );
    assert.match(
      state.stdout(),
      /rah worker message-post --send-draft --target '#room:thread-1'/u,
    );
    assert.match(state.stdout(), /You can also choose not to send anything\./u);
    assert.doesNotMatch(state.stdout(), /--anyway/u);
    // The whole point of the port: no receipt, cursor, key or draft id.
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
      /If repeated updates keep blocking the same draft and this is still the right reply, you may use:\n {2}rah worker message-post --send-draft --anyway --target '#room'/u,
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
    assert.match(state.stderr(), /rah worker message-post --target "#ops"/u);
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
    assert.equal(
      state.stderr(),
      "Error: message was NOT sent; no target delivery occurred.\nCode: THREAD_CONTEXT_TARGET_CONFIRMATION_REQUIRED\n",
      "stderr carries only the short renderError summary",
    );
    assert.match(
      state.stdout(),
      /THREAD_CONTEXT_TARGET_CONFIRMATION_REQUIRED/u,
    );
    assert.match(
      state.stdout(),
      /Possible thread target mismatch: your latest read context under '#room' is '#room:thread-1', but this send targets '#room' top-level\./u,
    );
    assert.match(
      state.stdout(),
      /This guard is intentionally narrow: moving a thread conclusion to the parent channel can be correct, but it is uncommon enough to confirm once\./u,
    );
    assert.match(
      state.stdout(),
      /If this reply belongs in the thread, send the message to the thread target instead:\n {2}rah worker message-post --target '#room:thread-1' <<'RAH_MESSAGE_EOF'/u,
    );
    assert.match(
      state.stdout(),
      /If the top-level channel message is intentional, send the saved draft unchanged:\n {2}rah worker message-post --send-draft --target '#room'/u,
    );
    assert.match(state.stdout(), /No message was sent\./u);
    assert.doesNotMatch(state.stdout(), /SEND_HELD_AS_DRAFT/u);
    assert.doesNotMatch(state.stdout(), /--held-draft-id/u);
    assert.doesNotMatch(state.stdout(), /--idempotency-key/u);
    assert.doesNotMatch(state.stdout(), /--context-receipt/u);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("--json restores the machine-readable send response on stdout", async () => {
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
    assert.equal(JSON.parse(state.stdout()).heldDraftId, "held-json");
    assert.doesNotMatch(state.stdout(), /Freshness hold: showing latest/u);
    assert.match(state.stderr(), /Code: SEND_HELD_AS_DRAFT/u);
    assert.deepEqual(
      sent,
      [{ body: "Original result" }],
      "--json is an output selector, never part of the send request",
    );
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("a successful send prints Raft's sent line and thread reply hint on stdout", async () => {
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
      'Message sent to #ops. Message ID: message_ab12cd34ef56 (to reply in this message\'s thread, use target "#ops:message_")\n',
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
      'Message sent to #ops:thread-1. Message ID: message_ffffffff0000 (to reply in this message\'s thread, use target "#ops:thread-1")\n',
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
