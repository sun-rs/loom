import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runWorkerCliCommand } from "../src/index.ts";

/**
 * Raft's `MENTION_DELIVERY_FAILED` branch: an `@token` that woke nobody does
 * not undo the post. The queued result is a rendered result and stays on
 * stdout; the partial condition is a raised error on stderr with exit 1.
 */
function fixture(response: Record<string, unknown>) {
  const directory = mkdtempSync(join(tmpdir(), "rah-mention-partial-"));
  chmodSync(directory, 0o700);
  const tokenPath = join(directory, "token");
  writeFileSync(tokenPath, "worker-secret", { mode: 0o600 });
  let stdout = "";
  let stderr = "";
  return {
    directory,
    runtime: {
      env: {
        RAH_ACTIVATION_ID: "activation-mention-1",
        RAH_WORKER_API_URL: "http://127.0.0.1:43123",
        RAH_WORKER_SESSION_FILE: tokenPath,
      },
      fetch: async () =>
        new Response(JSON.stringify(response), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      stderr: { write: (value: string) => (stderr += value) },
      stdout: { write: (value: string) => (stdout += value) },
    },
    stderr: () => stderr,
    stdout: () => stdout,
  };
}

const posted = {
  activationIds: [],
  deduplicated: false,
  event: {
    actorId: "agent-1",
    aggregateId: "message-1",
    aggregateType: "room",
    payload: { body: "@carol please review", messageId: "message-1" },
    roomSeq: 9,
    type: "message.posted",
  },
};

test("an @mention that woke nobody keeps the message queued and reports on stderr", async () => {
  const state = fixture({ ...posted, unresolvedMentionHandles: ["carol"] });
  try {
    const code = await runWorkerCliCommand(
      ["worker", "message-post", "--target", "#room", "--body", "@carol hi"],
      state.runtime,
    );
    assert.equal(code, 1, "Raft's partial result exits nonzero");

    const stdout = state.stdout();
    assert.match(stdout, /Undelivered mentions — partial result/);
    assert.match(stdout, /Message effect: status=queued/);
    assert.match(
      stdout,
      /@carol — status=not_queued reason=unknown_or_not_visible/,
    );
    assert.match(
      stdout,
      /Message queued to #room\./,
      "the receipt verb switches from sent to queued so a partial is never read as clean",
    );
    assert.doesNotMatch(stdout, /Message sent to/);

    const stderr = state.stderr();
    assert.match(stderr, /MENTION_DELIVERY_FAILED/);
    assert.match(stderr, /message status=queued; 1 @mention status=not_queued/);
    assert.match(stderr, /Do not resend the queued message\./);
    // RAH has no `mention notify` recovery surface, so Raft's per-token
    // recovery sentence is omitted rather than replaced with an invention.
    assert.doesNotMatch(stderr, /mention notify/);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("a send whose mentions all resolved is unchanged", async () => {
  const state = fixture(posted);
  try {
    const code = await runWorkerCliCommand(
      ["worker", "message-post", "--target", "#room", "--body", "hi"],
      state.runtime,
    );
    assert.equal(code, 0);
    assert.match(state.stdout(), /Message sent to #room\./);
    assert.doesNotMatch(state.stdout(), /Undelivered mentions/);
    assert.equal(state.stderr(), "");
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("--json carries the partial payload inside the error and writes no success payload", async () => {
  const state = fixture({ ...posted, unresolvedMentionHandles: ["carol"] });
  try {
    const code = await runWorkerCliCommand(
      [
        "worker",
        "message-post",
        "--target",
        "#room",
        "--body",
        "@carol hi",
        "--json",
      ],
      state.runtime,
    );
    assert.equal(code, 1);
    assert.equal(state.stdout(), "", "JSON mode writes no success payload");
    const rendered = JSON.parse(state.stderr()) as {
      error: { code: string; effect: string };
      ok: boolean;
    };
    assert.equal(rendered.ok, false);
    assert.equal(rendered.error.code, "MENTION_DELIVERY_FAILED");
    assert.equal(rendered.error.effect, "message_queued");
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});
