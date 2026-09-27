import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import {
  createWorkerTurnRoot,
  invokeWorkerTool,
  issueWorkerTurnHandle,
  runWorkerCliCommand,
  WORKER_TOOL_DEFINITIONS,
} from "../src/index.ts";

/**
 * Loom Worker tool facade (evo §57, owner decision 2026-09-27): the
 * structured `message_post` / `message_check` tools are a facade over the
 * SAME `runWorkerCliCommand`. The invariant is byte identity on the wire:
 * for the same reply, the tool path and the heredoc CLI path send the same
 * Worker HTTP request (URL, credential, JSON body — so the same
 * server-derived idempotency key, basedOn, final and target), and the tool
 * result is the CLI's own output text with the exit status as `isError`.
 */
type Captured = { url: string; authorization: string | null; body: string };

function fixture(
  answer: (url: string) => { status: number; body: unknown } = () => ({
    status: 200,
    body: { ok: true, roomSeq: 7, messageId: "message-1" },
  }),
) {
  const directory = mkdtempSync(join(tmpdir(), "loom-worker-tool-"));
  chmodSync(directory, 0o700);
  const tokenPath = join(directory, "token");
  writeFileSync(tokenPath, "worker-secret", { mode: 0o600 });
  const requests: Captured[] = [];
  const fetch = async (input: string, init: RequestInit) => {
    requests.push({
      url: String(input),
      authorization: new Headers(init.headers).get("authorization"),
      body: String(init.body),
    });
    const reply = answer(String(input));
    return new Response(JSON.stringify(reply.body), {
      headers: { "content-type": "application/json" },
      status: reply.status,
    });
  };
  const env = {
    RAH_ACTIVATION_ID: "activation-1",
    RAH_WORKER_API_URL: "http://127.0.0.1:43125",
    RAH_WORKER_SESSION_FILE: tokenPath,
  };
  return { directory, env, fetch, requests };
}

async function cli(
  argv: string[],
  state: ReturnType<typeof fixture>,
  stdin?: string,
  env: Record<string, string> = state.env,
) {
  let stdout = "";
  let stderr = "";
  const exit = await runWorkerCliCommand(argv, {
    env,
    fetch: state.fetch,
    stderr: { write: (value: string) => (stderr += value) },
    stdout: { write: (value: string) => (stdout += value) },
    ...(stdin === undefined ? {} : { stdin: Readable.from([stdin]) }),
  });
  return { exit, stderr, stdout };
}

test("message_post sends byte-identical Worker requests to the heredoc CLI path", async () => {
  const state = fixture();
  try {
    // The CLI form the standing prompt taught: target, seq, final, heredoc
    // body (the shell adds the trailing newline the CLI trims).
    const viaCli = await cli(
      [
        "worker",
        "message-post",
        "--target",
        "#main",
        "--based-on-room-seq",
        "12",
        "--final",
      ],
      state,
      "审查结论：  multi-line\n`quoted` $HOME 'x'\n",
    );
    assert.equal(viaCli.exit, 0);
    const viaTool = await invokeWorkerTool(
      "message_post",
      {
        target: "#main",
        body: "审查结论：  multi-line\n`quoted` $HOME 'x'",
        based_on_room_seq: 12,
        final: true,
      },
      { env: state.env, fetch: state.fetch },
    );
    assert.equal(viaTool.isError, false);
    assert.equal(state.requests.length, 2);
    assert.deepEqual(state.requests[1], state.requests[0]);
    assert.equal(
      state.requests[0]!.url,
      "http://127.0.0.1:43125/v1/worker/messages/post",
    );
    assert.deepEqual(JSON.parse(state.requests[0]!.body), {
      channel: "#main",
      basedOnRoomSeq: 12,
      body: "审查结论：  multi-line\n`quoted` $HOME 'x'",
      final: true,
    });
    // The tool result is the CLI's own output.
    assert.equal(viaTool.text, viaCli.stdout + viaCli.stderr);
    // A progress post (no final, no seq) stays identical too.
    await cli(
      ["worker", "message-post", "--target", "dm:@human"],
      state,
      "progress\n",
    );
    await invokeWorkerTool(
      "message_post",
      { target: "dm:@human", body: "progress" },
      { env: state.env, fetch: state.fetch },
    );
    assert.deepEqual(state.requests[3], state.requests[2]);
    assert.equal(JSON.parse(state.requests[2]!.body).final, undefined);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("a warm runtime's tool call uses the published current turn, like --turn on the CLI", async () => {
  const state = fixture();
  const runtimeDirectory = join(state.directory, "runtime");
  let root: string | undefined;
  try {
    root = await createWorkerTurnRoot(runtimeDirectory);
    const warmEnv = {
      RAH_WORKER_API_URL: state.env.RAH_WORKER_API_URL,
      RAH_WORKER_TURN_ROOT: root,
    };
    // No active turn: refused before any request, with the CLI's error form.
    const idle = await invokeWorkerTool(
      "message_post",
      { target: "#main", body: "late", based_on_room_seq: 3 },
      { env: warmEnv, fetch: state.fetch },
    );
    assert.equal(idle.isError, true);
    assert.match(idle.text, /TURN_HANDLE_INACTIVE/u);
    assert.match(idle.text, /Effect: not_sent/u);
    assert.equal(state.requests.length, 0);
    const turn = await issueWorkerTurnHandle(root, {
      current: true,
      revoke: () => undefined,
      scope: {
        RAH_ACTIVATION_ID: "activation-warm",
        RAH_FROM_SEQ: "2",
        RAH_ROOM_ID: "room-warm",
        RAH_RUN_ATTEMPT_ID: "run-warm",
        RAH_TO_SEQ: "3",
      },
      token: "turn-token",
    });
    const viaCli = await cli(
      [
        "worker",
        "message-post",
        "--turn",
        turn.handle,
        "--target",
        "#main",
        "--based-on-room-seq",
        "3",
        "--final",
      ],
      state,
      "answer\n",
      warmEnv,
    );
    assert.equal(viaCli.exit, 0);
    const viaTool = await invokeWorkerTool(
      "message_post",
      { target: "#main", body: "answer", based_on_room_seq: 3, final: true },
      { env: warmEnv, fetch: state.fetch },
    );
    assert.equal(viaTool.isError, false);
    assert.equal(state.requests[0]!.authorization, "Bearer turn-token");
    assert.deepEqual(state.requests[1], state.requests[0]);
    await turn.release();
    const after = await invokeWorkerTool(
      "message_check",
      {},
      { env: warmEnv, fetch: state.fetch },
    );
    assert.equal(after.isError, true);
    assert.match(after.text, /TURN_HANDLE_INACTIVE/u);
    assert.equal(state.requests.length, 2);
  } finally {
    if (root !== undefined && existsSync(root)) chmodSync(root, 0o700);
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("a refused post returns the CLI's own output as an error result", async () => {
  const refusal = {
    status: 409,
    body: {
      code: "target_confirmation_required",
      message: "This reply names a different target than the message.",
      heldDraftId: "draft-1",
      effect: "not_sent",
    },
  };
  const state = fixture(() => refusal);
  try {
    const viaCli = await cli(
      ["worker", "message-post", "--target", "#other"],
      state,
      "answer\n",
    );
    const viaTool = await invokeWorkerTool(
      "message_post",
      { target: "#other", body: "answer" },
      { env: state.env, fetch: state.fetch },
    );
    assert.equal(viaCli.exit, 1);
    assert.equal(viaTool.isError, true);
    assert.equal(viaTool.text, viaCli.stdout + viaCli.stderr);
    assert.deepEqual(state.requests[1], state.requests[0]);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("message_check maps to the CLI message-check; bad arguments never reach the server", async () => {
  const state = fixture(() => ({
    status: 200,
    body: {
      roomId: "room-1",
      events: [],
      hasMore: false,
      deliveredThroughSeq: 4,
    },
  }));
  try {
    const viaCli = await cli(["worker", "message-check", "--replay"], state);
    const viaTool = await invokeWorkerTool(
      "message_check",
      { replay: true },
      { env: state.env, fetch: state.fetch },
    );
    assert.equal(viaTool.isError, viaCli.exit !== 0);
    assert.equal(viaTool.text, viaCli.stdout + viaCli.stderr);
    assert.deepEqual(state.requests[1], state.requests[0]);
    const before = state.requests.length;
    for (const [name, args] of [
      ["message_post", { target: 7, body: "x" }],
      ["message_post", { target: "#main", body: ["x"] }],
      ["message_post", { target: "#main", body: "x", final: "yes" }],
      ["message_post", { target: "#main", body: "x", based_on_room_seq: "3" }],
      ["message_check", { replay: 1 }],
      ["task_claim", {}],
    ] as const) {
      const result = await invokeWorkerTool(name, args, {
        env: state.env,
        fetch: state.fetch,
      });
      assert.equal(result.isError, true, `${name} ${JSON.stringify(args)}`);
      assert.match(result.text, /INVALID_ARG/u);
    }
    assert.equal(state.requests.length, before);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("the tool schemas expose no turn handle or credential parameter", () => {
  assert.deepEqual(
    WORKER_TOOL_DEFINITIONS.map((tool) => tool.name),
    ["message_post", "message_check"],
  );
  const post = WORKER_TOOL_DEFINITIONS[0]!;
  assert.deepEqual(Object.keys(post.inputSchema.properties).sort(), [
    "based_on_room_seq",
    "body",
    "final",
    "target",
  ]);
  assert.deepEqual(post.inputSchema.required, ["target", "body"]);
  const serialized = JSON.stringify(WORKER_TOOL_DEFINITIONS);
  assert.doesNotMatch(serialized, /\bturn|handle"|token|credential|session/iu);
  // Compact: the per-request cost stays well under the review's estimate.
  assert.ok(
    serialized.length < 1100,
    `tool definitions ${serialized.length} B`,
  );
});
