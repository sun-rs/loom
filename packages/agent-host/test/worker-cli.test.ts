import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
