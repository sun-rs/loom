import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createWorkerTurnRoot,
  issueWorkerTurnHandle,
  readCurrentWorkerTurn,
  removeWorkerTurnRoot,
  runWorkerCliCommand,
} from "../src/index.ts";

/**
 * S2-a per-turn authority (S2 spec §3, 方案 C): a random handle names a
 * directory under a non-listable turn root; only that turn's wake text carries
 * it. Old tools that remember handle N are refused once N is revoked, and they
 * cannot discover N+1 because the root cannot be listed.
 */
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-turn-handle-"));
  chmodSync(directory, 0o700);
  const requests: { authorization: string | null; url: string }[] = [];
  let stdout = "";
  let stderr = "";
  const runtime = (root: string) => ({
    env: {
      RAH_WORKER_API_URL: "http://127.0.0.1:43124",
      RAH_WORKER_TURN_ROOT: root,
      RAH_PARTICIPANT_ID: "instance-1",
    },
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        authorization: new Headers(init?.headers).get("authorization"),
        url: String(input),
      });
      return new Response(JSON.stringify({ ok: true, roomSeq: 7 }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    },
    stderr: { write: (value: string) => (stderr += value) },
    stdout: { write: (value: string) => (stdout += value) },
  });
  return {
    directory,
    requests,
    runtime,
    stderr: () => stderr,
    stdout: () => stdout,
    reset() {
      stdout = "";
      stderr = "";
    },
  };
}

function cleanup(directory: string) {
  for (const name of ["runtime", "legacy"])
    if (existsSync(join(directory, name, "turns")))
      chmodSync(join(directory, name, "turns"), 0o700);
  rmSync(directory, { force: true, recursive: true });
}

const scope = (suffix: string) => ({
  RAH_ACTIVATION_ID: `activation-${suffix}`,
  RAH_FROM_SEQ: "1",
  RAH_ROOM_ID: `room-${suffix}`,
  RAH_RUN_ATTEMPT_ID: `run-${suffix}`,
  RAH_TO_SEQ: "3",
});

test("turn handles live under a non-listable root with owner-private files", async () => {
  const state = fixture();
  try {
    const root = await createWorkerTurnRoot(join(state.directory, "runtime"));
    assert.equal(statSync(root).mode & 0o777, 0o300);
    assert.throws(
      () => readdirSync(root),
      /EACCES/u,
      "the root is not listable",
    );
    let revoked = 0;
    const handle = await issueWorkerTurnHandle(root, {
      revoke: () => {
        revoked += 1;
      },
      scope: scope("1"),
      token: "turn-1-token",
    });
    assert.match(handle.handle, /^[A-Za-z0-9_-]{22}$/u);
    assert.equal(statSync(join(root, handle.handle)).mode & 0o777, 0o700);
    assert.equal(statSync(handle.tokenPath).mode & 0o777, 0o600);
    assert.equal(
      statSync(join(root, handle.handle, "scope.json")).mode & 0o777,
      0o600,
    );
    const outcome = await handle.release();
    assert.deepEqual(outcome, { removed: true, revoked: true });
    assert.equal(revoked, 1);
    assert.equal(existsSync(join(root, handle.handle)), false);
    // Release is idempotent: revocation is never repeated.
    await handle.release();
    assert.equal(revoked, 1);
    await removeWorkerTurnRoot(root);
    assert.equal(existsSync(root), false);
  } finally {
    cleanup(state.directory);
  }
});

test("revocation failure still removes the handle and is reported, never thrown", async () => {
  const state = fixture();
  try {
    const root = await createWorkerTurnRoot(join(state.directory, "runtime"));
    const handle = await issueWorkerTurnHandle(root, {
      revoke: () => {
        throw new Error("kernel unavailable");
      },
      scope: scope("1"),
      token: "turn-1-token",
    });
    const outcome = await handle.release();
    assert.equal(outcome.revoked, false);
    assert.equal(outcome.removed, true);
    assert.match(String(outcome.revokeError), /kernel unavailable/u);
  } finally {
    cleanup(state.directory);
  }
});

test("the warm Worker CLI requires --turn, uses that turn's token and scope, and refuses revoked handles", async () => {
  const state = fixture();
  try {
    const root = await createWorkerTurnRoot(join(state.directory, "runtime"));
    const first = await issueWorkerTurnHandle(root, {
      revoke: () => undefined,
      scope: scope("1"),
      token: "turn-1-token",
    });
    const runtime = state.runtime(root);

    assert.equal(await runWorkerCliCommand(["worker", "sync"], runtime), 1);
    assert.match(state.stderr(), /TURN_HANDLE_REQUIRED/u);
    assert.equal(state.requests.length, 0);
    state.reset();

    assert.equal(
      await runWorkerCliCommand(
        ["worker", "sync", "--turn", first.handle, "--after-seq", "2"],
        runtime,
      ),
      0,
    );
    assert.equal(state.requests[0]?.authorization, "Bearer turn-1-token");
    state.reset();

    // Turn N ends: the handle is revoked and removed before quiescence.
    await first.release();
    const second = await issueWorkerTurnHandle(root, {
      revoke: () => undefined,
      scope: scope("2"),
      token: "turn-2-token",
    });
    // A background tool of turn N still holding handle N gets no authority,
    // and learns only to use the handle of the latest wake.
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "sync", "--turn", first.handle],
        runtime,
      ),
      1,
    );
    assert.match(state.stderr(), /TURN_HANDLE_INACTIVE/u);
    assert.match(state.stderr(), /latest wake/u);
    assert.doesNotMatch(state.stderr(), new RegExp(second.handle, "u"));
    assert.equal(state.requests.length, 1, "no request left the CLI");
    state.reset();

    for (const bad of ["../x", "a/b", "short", `${second.handle}/..`])
      assert.equal(
        await runWorkerCliCommand(["worker", "sync", "--turn", bad], runtime),
        1,
        `malformed handle ${bad} is refused`,
      );
    assert.equal(state.requests.length, 1);

    assert.equal(
      await runWorkerCliCommand(
        ["worker", "sync", "--turn", second.handle],
        runtime,
      ),
      0,
    );
    assert.equal(state.requests[1]?.authorization, "Bearer turn-2-token");
  } finally {
    cleanup(state.directory);
  }
});

test("legacy per-Activation runtimes keep the environment credential path", async () => {
  const state = fixture();
  try {
    const runtime = state.runtime("");
    const { RAH_WORKER_TURN_ROOT: _unused, ...env } = runtime.env;
    const tokenDirectory = join(state.directory, "legacy");
    const root = await createWorkerTurnRoot(tokenDirectory);
    const handle = await issueWorkerTurnHandle(root, {
      revoke: () => undefined,
      scope: scope("legacy"),
      token: "legacy-token",
    });
    assert.equal(
      await runWorkerCliCommand(["worker", "sync"], {
        ...runtime,
        env: { ...env, RAH_WORKER_SESSION_FILE: handle.tokenPath },
      }),
      0,
    );
    assert.equal(state.requests[0]?.authorization, "Bearer legacy-token");
  } finally {
    cleanup(state.directory);
  }
});

test("a tool-facade runtime publishes only the active turn's handle, cleared before revocation", async () => {
  const state = fixture();
  try {
    const root = await createWorkerTurnRoot(join(state.directory, "runtime"));
    // Without the option nothing names the current turn.
    const plain = await issueWorkerTurnHandle(root, {
      revoke: () => undefined,
      scope: scope("0"),
      token: "turn-0-token",
    });
    assert.equal(await readCurrentWorkerTurn(root), undefined);
    await plain.release();
    let pointerAtRevoke: string | undefined = "unread";
    const first = await issueWorkerTurnHandle(root, {
      current: true,
      revoke: async () => {
        pointerAtRevoke = await readCurrentWorkerTurn(root);
      },
      scope: scope("1"),
      token: "turn-1-token",
    });
    assert.equal(await readCurrentWorkerTurn(root), first.handle);
    assert.equal(statSync(join(root, "current")).mode & 0o777, 0o600);
    await first.release();
    assert.equal(pointerAtRevoke, undefined, "cleared before revocation");
    assert.equal(await readCurrentWorkerTurn(root), undefined);
    // A late release of an older turn never clears a newer turn's pointer.
    const older = await issueWorkerTurnHandle(root, {
      current: true,
      revoke: () => undefined,
      scope: scope("2"),
      token: "turn-2-token",
    });
    const newer = await issueWorkerTurnHandle(root, {
      current: true,
      revoke: () => undefined,
      scope: scope("3"),
      token: "turn-3-token",
    });
    await older.release();
    assert.equal(await readCurrentWorkerTurn(root), newer.handle);
    await newer.release();
    // A pointer that is not owner-private is never trusted.
    writeFileSync(join(root, "current"), newer.handle, { mode: 0o644 });
    chmodSync(join(root, "current"), 0o644);
    assert.equal(await readCurrentWorkerTurn(root), undefined);
    // No turn root (a per-Activation runtime): nothing to read.
    assert.equal(await readCurrentWorkerTurn(undefined), undefined);
  } finally {
    cleanup(state.directory);
  }
});
