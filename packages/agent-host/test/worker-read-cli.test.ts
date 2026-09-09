import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runWorkerCliCommand } from "../src/index.ts";

test("Worker read CLI exposes bounded history, identity and Task tools without actor flags", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rah-read-cli-"));
  const session = join(dir, "session");
  writeFileSync(session, "private-token", { mode: 0o600 });
  const requests: Array<{ path: string; body: unknown }> = [];
  let errors = "";
  const runtime = {
    env: {
      RAH_ACTIVATION_ID: "activation",
      RAH_WORKER_API_URL: "http://127.0.0.1:43123",
      RAH_WORKER_SESSION_FILE: session,
    },
    fetch: async (path: string, input: RequestInit) => {
      requests.push({ path, body: JSON.parse(String(input.body)) });
      return new Response("{}");
    },
    stdout: { write() {} },
    stderr: {
      write(value: string) {
        errors += value;
      },
    },
  };
  try {
    for (const [args, path, body] of [
      [
        ["message-read", "--around", "message-123", "--limit", "3"],
        "messages/history",
        { around: "message-123", limit: 3 },
      ],
      [
        ["message-resolve", "--message-id", "message-123"],
        "messages/resolve",
        { messageId: "message-123" },
      ],
      [
        [
          "task-assign",
          "--task-id",
          "task-123",
          "--assignee",
          "agent-456",
          "--based-on-room-seq",
          "9",
          "--idempotency-key",
          "assign",
        ],
        "tasks/assign",
        {
          taskId: "task-123",
          assigneeId: "agent-456",
          basedOnRoomSeq: 9,
          idempotencyKey: "assign",
        },
      ],
      [
        [
          "task-assign",
          "--task-id",
          "task-123",
          "--unassign",
          "--based-on-room-seq",
          "10",
          "--idempotency-key",
          "clear",
        ],
        "tasks/assign",
        {
          taskId: "task-123",
          assigneeId: null,
          basedOnRoomSeq: 10,
          idempotencyKey: "clear",
        },
      ],
      [
        [
          "task-convert",
          "--message-id",
          "message-123",
          "--based-on-room-seq",
          "8",
          "--idempotency-key",
          "convert",
        ],
        "tasks/convert",
        {
          messageId: "message-123",
          basedOnRoomSeq: 8,
          idempotencyKey: "convert",
        },
      ],
      [["room-members"], "room/members", { limit: 50 }],
      [["server-info"], "server/info", { limit: 50 }],
      [
        [
          "profile-show",
          "--target",
          "@human",
          "--created-agents-limit",
          "2",
          "--created-agents-cursor",
          "opaque-cursor",
        ],
        "profiles/get",
        {
          target: "@human",
          createdAgentsLimit: 2,
          createdAgentsCursor: "opaque-cursor",
        },
      ],
      [
        ["profile-show", "--target", "@human"],
        "profiles/get",
        { target: "@human" },
      ],
      [
        ["task-list", "--mine", "--status", "todo"],
        "tasks/list",
        { limit: 50, mine: true, status: "todo" },
      ],
      [
        ["task-history", "--task-id", "task-123", "--limit", "5"],
        "tasks/history",
        { limit: 5, taskId: "task-123" },
      ],
    ] as const) {
      assert.equal(
        await runWorkerCliCommand(["worker", ...args], runtime),
        0,
        errors,
      );
      assert.equal(
        requests.at(-1)!.path,
        `http://127.0.0.1:43123/v1/worker/${path}`,
      );
      assert.deepEqual(requests.at(-1)!.body, body);
    }
    const accepted = requests.length;
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-read", "--room-id", "foreign"],
        runtime,
      ),
      1,
    );
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "task-list", "--actor-id", "human"],
        runtime,
      ),
      1,
    );
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "message-read", "--limit", "101"],
        runtime,
      ),
      1,
    );
    // Raft puts `--json` on 19 of its 80 commands and on none of the read
    // family but `version`; a read command that is offered the flag must fail
    // closed rather than quietly switch format.
    for (const command of ["sync", "message-read", "task-list", "whoami"])
      assert.equal(
        await runWorkerCliCommand(["worker", command, "--json"], runtime),
        1,
      );
    assert.equal(requests.length, accepted);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
