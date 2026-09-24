import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The warm Claude driver's turn boundary against frame orderings the scripted
 * fakes never produce, driven frame by frame (FAKE Claude, no model):
 *
 * - seventh review P1-3: an independent failure of another admitted input is
 *   never hidden by the final-reply end; only an abort this driver's own
 *   interrupt caused is exempt, and the Host keeps the error text;
 * - P2-1: a started input settles only through its own `result`; a terminal
 *   lifecycle first does not close the turn; with lifecycle capability a
 *   `result` without `user_message_uuid` is never guessed onto an input; an
 *   input the CLI refused or cancelled without being asked is an error;
 * - Claude busy input: a surviving notice that starts after the final reply
 *   armed is interrupted too.
 */
const DRIVER = fileURLToPath(
  new URL("../src/claude-warm-driver.mjs", import.meta.url),
);
const FAKE = fileURLToPath(
  new URL("./fixtures/fake-claude-remote.mjs", import.meta.url),
);

type Json = Record<string, any>;

async function startDriver() {
  const directory = mkdtempSync(join(tmpdir(), "loom-claude-warm-close-"));
  chmodSync(directory, 0o700);
  const executable = join(directory, "claude");
  writeFileSync(
    executable,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(FAKE)} "$@"\n`,
    { mode: 0o700 },
  );
  const inbound: Json[] = [];
  let socket: Socket | undefined;
  const server = createServer((connection) => {
    socket = connection;
    connection.setEncoding("utf8");
    let buffer = "";
    connection.on("data", (chunk: string) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.trim() !== "") inbound.push(JSON.parse(line) as Json);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const child = spawn(
    process.execPath,
    [
      DRIVER,
      "--executable",
      executable,
      "--tool-access-mode",
      "full_access",
      "--prompt",
      "FAKE standing prompt",
      "--runtime-id",
      "rt-1",
      "--host-generation",
      "gen-1",
    ],
    {
      cwd: directory,
      env: { ...process.env, FAKE_CLAUDE_CONTROL_PORT: String(port) },
      stdio: ["pipe", "pipe", "pipe", "pipe"],
    },
  );
  const frames: Json[] = [];
  let fd3 = "";
  child.stdio[3]!.on("data", (chunk: Buffer) => {
    fd3 += chunk.toString();
    let index;
    while ((index = fd3.indexOf("\n")) >= 0) {
      const line = fd3.slice(0, index);
      fd3 = fd3.slice(index + 1);
      if (line.trim() !== "") frames.push(JSON.parse(line) as Json);
    }
  });
  let stderr = "";
  child.stderr!.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  child.stdout!.resume();
  const until = async <T>(probe: () => T | undefined, label: string) => {
    for (let i = 0; i < 400; i += 1) {
      const value = probe();
      if (value !== undefined) return value;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail(`timed out waiting for ${label}; stderr: ${stderr}`);
  };
  let consumed = 0;
  const h = {
    frames,
    inbound,
    host(command: Json) {
      child.stdin!.write(`${JSON.stringify(command)}\n`);
    },
    claude(frame: Json) {
      socket!.write(`${JSON.stringify(frame)}\n`);
    },
    /** The next line the driver wrote to Claude matching `predicate`. */
    async input(predicate: (line: Json) => boolean, label: string) {
      return await until(() => {
        for (let i = consumed; i < inbound.length; i += 1)
          if (predicate(inbound[i]!)) {
            consumed = i + 1;
            return inbound[i]!;
          }
        return undefined;
      }, label);
    },
    async frame(predicate: (frame: Json) => boolean, label: string) {
      return await until(() => frames.find(predicate), label);
    },
    async settle(ms = 150) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    },
    async close() {
      child.stdin!.end();
      await new Promise((resolve) => child.once("close", resolve));
      server.close();
      rmSync(directory, { force: true, recursive: true });
    },
  };
  await until(() => (socket === undefined ? undefined : true), "fake connect");
  await h.frame((f) => f.type === "ready", "ready");
  return h;
}

type Driver = Awaited<ReturnType<typeof startDriver>>;

const drained = (h: Driver) =>
  h.frames.find((frame) => frame.type === "turn.drained");
const lifecycle = (uuid: string, state: string) => ({
  type: "command_lifecycle",
  command_uuid: uuid,
  state,
});
const result = (uuid: string | undefined, fields: Json) => ({
  type: "result",
  num_turns: 1,
  usage: { input_tokens: 1, output_tokens: 1 },
  ...(uuid === undefined ? {} : { user_message_uuid: uuid }),
  ...fields,
});
const success = { subtype: "success", is_error: false, result: "ok" };
const aborted = {
  subtype: "error_during_execution",
  is_error: true,
  errors: [],
  terminal_reason: "aborted_tools",
};

/** Begins run-1, accepts its wake, returns the wake uuid. */
async function acceptedWake(h: Driver) {
  h.host({
    op: "turn.begin",
    runAttemptId: "run-1",
    runtimeRunId: "rr-1",
    text: "FAKE wake",
  });
  const wake = await h.input((line) => line.type === "user", "wake input");
  h.claude(lifecycle(wake.uuid, "queued"));
  h.claude(lifecycle(wake.uuid, "started"));
  h.claude({
    type: "system",
    subtype: "init",
    capabilities: ["msg_lifecycle_v1", "interrupt_receipt_v1"],
  });
  h.claude({
    type: "user",
    isReplay: true,
    uuid: wake.uuid,
    message: { role: "user", content: [{ type: "text", text: "FAKE wake" }] },
  });
  await h.frame((f) => f.type === "turn.accepted", "accepted");
  return String(wake.uuid);
}

/** Writes one busy notice and returns its uuid once written. */
async function notice(h: Driver, id = "n1") {
  h.host({
    op: "turn.notice",
    runAttemptId: "run-1",
    line: JSON.stringify({
      protocol: "rah-runtime-notice/v1",
      id,
      text: `FAKE busy human input ${id}`,
      fingerprint: "a".repeat(63) + String(id.length % 10),
    }),
  });
  const input = await h.input(
    (line) => line.type === "user" && JSON.stringify(line).includes(id),
    "notice input",
  );
  await h.frame(
    (f) => f.type === "frame" && f.frame?.id === id,
    "notice receipt",
  );
  h.claude(lifecycle(input.uuid, "queued"));
  return String(input.uuid);
}

/** The posting tool call finishes, then the Host arms the final reply. */
async function finalPostedAndArmed(h: Driver, wake: string) {
  h.claude({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "tool-post",
          name: "Bash",
          input: { command: "rah worker message-post --final --body done" },
        },
      ],
    },
  });
  h.claude({
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tool-post", content: "ok" },
      ],
    },
  });
  h.host({ op: "turn.final", runAttemptId: "run-1", nativeTurnId: wake });
  return await h.input(
    (line) =>
      line.type === "control_request" && line.request?.subtype === "interrupt",
    "final interrupt",
  );
}

const answer = (request: Json, response: Json = {}) => ({
  type: "control_response",
  response: {
    subtype: "success",
    request_id: request.request_id,
    response,
  },
});

test("P1-3: the wake's final reply ends, but an admitted notice failed on its own: the turn is failed with the error kept", async () => {
  const h = await startDriver();
  try {
    const wake = await acceptedWake(h);
    const busy = await notice(h);
    const interrupt = await finalPostedAndArmed(h, wake);
    h.claude(answer(interrupt, { still_queued: [busy], cancelled: [] }));
    h.claude(result(wake, aborted));
    h.claude(lifecycle(wake, "cancelled"));
    h.claude(lifecycle(busy, "started"));
    // The survivor is interrupted again (Claude busy input rule) but fails on
    // its own before that interrupt lands.
    const again = await h.input(
      (line) =>
        line.type === "control_request" &&
        line.request?.subtype === "interrupt",
      "survivor interrupt",
    );
    h.claude(
      result(busy, {
        subtype: "error_during_execution",
        is_error: true,
        errors: ["FAKE notice provider failure"],
        terminal_reason: "model_error",
      }),
    );
    h.claude(lifecycle(busy, "completed"));
    h.claude(answer(again));
    const end = await h.frame((f) => f.type === "turn.drained", "drained");
    assert.equal(end.status, "failed");
    assert.match(String(end.errorMessage), /FAKE notice provider failure/u);
    assert.equal(end.endedAfterFinalReply, undefined);
  } finally {
    await h.close();
  }
});

test("Claude busy input: a surviving notice that starts after the final reply armed is interrupted; its abort is the final end's, not an error", async () => {
  const h = await startDriver();
  try {
    const wake = await acceptedWake(h);
    const busy = await notice(h);
    const interrupt = await finalPostedAndArmed(h, wake);
    h.claude(answer(interrupt, { still_queued: [busy], cancelled: [] }));
    h.claude(result(wake, aborted));
    h.claude(lifecycle(wake, "cancelled"));
    h.claude(lifecycle(busy, "started"));
    const again = await h.input(
      (line) =>
        line.type === "control_request" &&
        line.request?.subtype === "interrupt",
      "survivor interrupt",
    );
    h.claude(answer(again));
    await h.settle(30);
    h.claude(
      result(busy, { ...aborted, terminal_reason: "aborted_streaming" }),
    );
    h.claude(lifecycle(busy, "cancelled"));
    const end = await h.frame((f) => f.type === "turn.drained", "drained");
    assert.equal(end.status, "interrupted");
    assert.equal(end.endedAfterFinalReply, true);
    assert.equal(end.errorMessage, undefined);
  } finally {
    await h.close();
  }
});

test("P2-1: a terminal lifecycle before the started wake's result does not close the turn; the result does", async () => {
  const h = await startDriver();
  try {
    const wake = await acceptedWake(h);
    h.claude(lifecycle(wake, "completed"));
    await h.settle();
    assert.equal(drained(h), undefined, "no result yet: the turn stays open");
    h.claude(result(wake, success));
    const end = await h.frame((f) => f.type === "turn.drained", "drained");
    assert.equal(end.status, "completed");
  } finally {
    await h.close();
  }
});

test("P2-1: a failing result after an early terminal lifecycle still fails the turn", async () => {
  const h = await startDriver();
  try {
    const wake = await acceptedWake(h);
    h.claude(lifecycle(wake, "completed"));
    await h.settle(50);
    h.claude(
      result(wake, {
        subtype: "error_during_execution",
        is_error: true,
        errors: ["FAKE late provider failure"],
        terminal_reason: "model_error",
      }),
    );
    const end = await h.frame((f) => f.type === "turn.drained", "drained");
    assert.equal(end.status, "failed");
    assert.match(String(end.errorMessage), /FAKE late provider failure/u);
  } finally {
    await h.close();
  }
});

test("P2-1: with lifecycle capability a result without user_message_uuid is never guessed onto the wake", async () => {
  const h = await startDriver();
  try {
    const wake = await acceptedWake(h);
    h.claude(result(undefined, success));
    await h.settle();
    assert.equal(
      drained(h),
      undefined,
      "the unattributed result settles nothing",
    );
    assert.ok(
      h.frames.some((f) => f.type === "unattributed" && f.method === "result"),
    );
    h.claude(result(wake, success));
    const end = await h.frame((f) => f.type === "turn.drained", "drained");
    assert.equal(end.status, "failed", "the unattributable result is an error");
  } finally {
    await h.close();
  }
});

test("P2-1: an admitted notice the CLI refused before starting is an error of the turn", async () => {
  const h = await startDriver();
  try {
    const wake = await acceptedWake(h);
    const busy = await notice(h);
    h.claude(lifecycle(busy, "refused"));
    h.claude(result(wake, success));
    h.claude(lifecycle(wake, "completed"));
    const end = await h.frame((f) => f.type === "turn.drained", "drained");
    assert.equal(end.status, "failed");
    assert.match(String(end.errorMessage), /refused/u);
  } finally {
    await h.close();
  }
});

test("P2-1: a queued notice the final interrupt cancelled (receipt) is not an error", async () => {
  const h = await startDriver();
  try {
    const wake = await acceptedWake(h);
    const busy = await notice(h);
    const interrupt = await finalPostedAndArmed(h, wake);
    h.claude(lifecycle(busy, "cancelled"));
    h.claude(answer(interrupt, { still_queued: [], cancelled: [busy] }));
    await h.settle(30);
    h.claude(result(wake, aborted));
    h.claude(lifecycle(wake, "cancelled"));
    const end = await h.frame((f) => f.type === "turn.drained", "drained");
    assert.equal(end.status, "interrupted");
    assert.equal(end.endedAfterFinalReply, true);
  } finally {
    await h.close();
  }
});

test("P2-4 (warm): a reason-less error_during_execution before the interrupt receipt is not the final end", async () => {
  const h = await startDriver();
  try {
    const wake = await acceptedWake(h);
    const interrupt = await finalPostedAndArmed(h, wake);
    h.claude(
      result(wake, {
        subtype: "error_during_execution",
        is_error: true,
        errors: ["FAKE provider failure"],
      }),
    );
    h.claude(lifecycle(wake, "cancelled"));
    // The receipt arrives only after the result was judged.
    await h.settle(50);
    h.claude(answer(interrupt));
    const end = await h.frame((f) => f.type === "turn.drained", "drained");
    assert.equal(end.status, "failed");
    assert.equal(end.endedAfterFinalReply, undefined);
  } finally {
    await h.close();
  }
});
