import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { runWorkerCliCommand } from "../src/index.ts";

/**
 * Raft resolves send content down two different paths: `resolveSendContent` for
 * a normal send, which reads the stream to the end and has no observation
 * window, and `resolveOptionalSendContent` for `--send-draft`, which only
 * observes whether stdin was supplied by mistake. RAH used one 250ms window for
 * both and resolved it to an empty string.
 */
function fixture(stdin?: NodeJS.ReadableStream) {
  const directory = mkdtempSync(join(tmpdir(), "rah-send-stdin-"));
  chmodSync(directory, 0o700);
  const tokenPath = join(directory, "token");
  writeFileSync(tokenPath, "worker-secret", { mode: 0o600 });
  let stdout = "";
  let stderr = "";
  const sent: unknown[] = [];
  return {
    directory,
    runtime: {
      env: {
        RAH_ACTIVATION_ID: "activation-stdin-1",
        RAH_WORKER_API_URL: "http://127.0.0.1:43123",
        RAH_WORKER_SESSION_FILE: tokenPath,
      },
      fetch: async (_input: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body ?? "{}")));
        return new Response(
          JSON.stringify({
            activationIds: [],
            deduplicated: false,
            event: {
              actorId: "agent-1",
              aggregateId: "message-1",
              aggregateType: "room",
              payload: { messageId: "message-1" },
              roomSeq: 3,
              type: "message.posted",
            },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      },
      ...(stdin === undefined ? {} : { stdin }),
      stderr: { write: (value: string) => (stderr += value) },
      stdout: { write: (value: string) => (stdout += value) },
    },
    sent,
    stderr: () => stderr,
    stdout: () => stdout,
  };
}

/** A stream that stays open past a deadline and then delivers its body. */
function slowStream(body: string, delayMs: number): NodeJS.ReadableStream {
  const stream = new Readable({ read() {} });
  setTimeout(() => {
    stream.push(body);
    stream.push(null);
  }, delayMs);
  return stream;
}

function closedStream(body = ""): NodeJS.ReadableStream {
  return Readable.from(body === "" ? [] : [body]);
}

test("a normal send waits for a heredoc that arrives after the draft observation window", async () => {
  // 1000ms is upstream's draft window; a normal send must not be bounded by it.
  const state = fixture(slowStream("late but real body", 1_400));
  try {
    const code = await runWorkerCliCommand(
      ["worker", "message-post", "--target", "#room"],
      state.runtime,
    );
    assert.equal(code, 0, state.stderr());
    assert.equal(
      (state.sent[0] as { body: string }).body,
      "late but real body",
      "a slow heredoc is content, not an empty body",
    );
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("a normal send with an empty stream is MISSING_CONTENT, never a silent empty body", async () => {
  const state = fixture(closedStream());
  try {
    const code = await runWorkerCliCommand(
      ["worker", "message-post", "--target", "#room"],
      state.runtime,
    );
    assert.equal(code, 1);
    assert.match(state.stderr(), /MISSING_CONTENT/);
    assert.equal(state.sent.length, 0, "nothing may be sent");
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("a stream error on a normal send fails instead of sending an empty body", async () => {
  const stream = new Readable({ read() {} });
  const state = fixture(stream);
  setTimeout(() => stream.destroy(new Error("pipe collapsed")), 20);
  try {
    const code = await runWorkerCliCommand(
      ["worker", "message-post", "--target", "#room"],
      state.runtime,
    );
    assert.equal(code, 1);
    assert.equal(state.sent.length, 0);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("--send-draft with no stdin sends the draft and reports the expired window on stderr", async () => {
  const stream = new Readable({ read() {} });
  const state = fixture(stream);
  try {
    const code = await runWorkerCliCommand(
      ["worker", "message-post", "--target", "#room", "--send-draft"],
      state.runtime,
    );
    assert.equal(code, 0, state.stderr());
    assert.equal((state.sent[0] as { sendDraft: boolean }).sendDraft, true);
    assert.match(
      state.stderr(),
      /No stdin bytes were detected within 1000ms; the stored draft will now be sent\./,
      "the Agent must be able to tell 'no heredoc' from 'heredoc too slow'",
    );
  } finally {
    stream.destroy();
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("--send-draft with unexpected stdin is refused, not silently ignored", async () => {
  const state = fixture(closedStream("revised body"));
  try {
    const code = await runWorkerCliCommand(
      ["worker", "message-post", "--target", "#room", "--send-draft"],
      state.runtime,
    );
    assert.equal(code, 1);
    assert.match(state.stderr(), /SEND_DRAFT_STDIN_UNSUPPORTED/);
    assert.equal(state.sent.length, 0);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("--send-draft distinguishes a closed empty stream from an expired window", async () => {
  // Upstream settles "end" when the stream closes with no bytes and "deadline"
  // only when the window expires, and calls onNoBytesWithinWindow for the
  // deadline alone. A promptly closed stdin is therefore not diagnosed.
  const state = fixture(closedStream());
  try {
    const code = await runWorkerCliCommand(
      ["worker", "message-post", "--target", "#room", "--send-draft"],
      state.runtime,
    );
    assert.equal(code, 0, state.stderr());
    assert.equal((state.sent[0] as { sendDraft: boolean }).sendDraft, true);
    assert.doesNotMatch(
      state.stderr(),
      /stored draft will now be sent/,
      "a stream that ended is not a window that expired",
    );
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("a normal send never reports the draft window diagnostic", async () => {
  const state = fixture(closedStream("a body"));
  try {
    const code = await runWorkerCliCommand(
      ["worker", "message-post", "--target", "#room"],
      state.runtime,
    );
    assert.equal(code, 0, state.stderr());
    assert.doesNotMatch(state.stderr(), /stored draft will now be sent/);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});
