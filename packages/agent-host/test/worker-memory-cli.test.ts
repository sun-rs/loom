import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { runWorkerCliCommand, workerHelpTopic } from "../src/index.ts";

// evo S6 batch A: `worker memory <action>` is a thin facade. It never sends
// a channel, author or provenance field; the Kernel derives them from the
// credential. Fake Worker API, no provider.

const detail = {
  entryId: "memory-1",
  channelId: "room-home",
  name: "deploy",
  type: "project",
  description: "how we deploy",
  pinned: false,
  state: "active",
  revision: 1,
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
  body: "Deploy with the release script.",
  provenance: {
    actorPrincipalId: "instance-1",
    actorKind: "instance",
    roleId: "role-1",
    roleRevisionId: "role-rev-1",
    instanceId: "instance-1",
    modelBindingId: null,
    modelReasoning: null,
    sessionGeneration: 0,
    runAttemptId: "run-1",
    viaRoomId: "room-home",
    basedOnRoomSeq: 7,
    recordedAt: "2026-09-26T00:00:00.000Z",
  },
};

function harness(responses: Record<string, unknown>) {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-cli-"));
  const token = join(directory, "token");
  writeFileSync(token, "test-private", { mode: 0o600 });
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  let stdout = "";
  let stderr = "";
  const runtime = (stdin?: string) => ({
    env: {
      RAH_WORKER_API_URL: "http://127.0.0.1:43001",
      RAH_WORKER_SESSION_FILE: token,
    },
    fetch: async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      calls.push({ path, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(responses[path] ?? {}));
    },
    ...(stdin === undefined ? {} : { stdin: Readable.from([stdin]) }),
    stdout: { write: (value: string) => (stdout += value) },
    stderr: { write: (value: string) => (stderr += value) },
  });
  return {
    calls,
    runtime,
    stdout: () => stdout,
    stderr: () => stderr,
    close: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("memory write reads the body from stdin and sends no scope or author", async () => {
  const h = harness({
    "/v1/worker/memory/write": {
      entryId: "memory-1",
      name: "deploy",
      revision: 1,
      op: "create",
      state: "active",
      deduplicated: false,
    },
  });
  try {
    const code = await runWorkerCliCommand(
      [
        "worker",
        "memory",
        "write",
        "--name",
        "deploy",
        "--type",
        "project",
        "--description",
        "how we deploy",
      ],
      h.runtime("Deploy with the release script.\n"),
    );
    assert.equal(code, 0, h.stderr());
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0]!.path, "/v1/worker/memory/write");
    const { idempotencyKey, ...body } = h.calls[0]!.body;
    assert.match(String(idempotencyKey), /^memory-/u);
    assert.deepEqual(body, {
      name: "deploy",
      type: "project",
      description: "how we deploy",
      body: "Deploy with the release script.\n",
    });
    assert.match(h.stdout(), /Memory create: deploy \(revision 1\)/u);
  } finally {
    h.close();
  }
});

test("memory commands refuse scope and author options before any request", async () => {
  const h = harness({});
  try {
    for (const extra of [
      ["--channel", "#other"],
      ["--actor-id", "someone"],
      ["--instance-id", "someone"],
    ]) {
      const code = await runWorkerCliCommand(
        ["worker", "memory", "read", "--name", "deploy", ...extra],
        h.runtime(),
      );
      assert.equal(code, 1, extra.join(" "));
    }
    assert.equal(
      await runWorkerCliCommand(["worker", "memory", "delete"], h.runtime()),
      1,
      "delete is Human-only and has no Worker command",
    );
    assert.equal(h.calls.length, 0);
    assert.match(h.stderr(), /INVALID_ARG/u);
  } finally {
    h.close();
  }
});

test("memory update sends only the changed fields and the expected revision", async () => {
  const h = harness({
    "/v1/worker/memory/update": {
      entryId: "memory-1",
      name: "deploy",
      revision: 2,
      op: "update",
      state: "active",
      deduplicated: false,
    },
  });
  try {
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "memory",
          "update",
          "--name",
          "deploy",
          "--expected-revision",
          "1",
          "--description",
          "new line",
          "--idempotency-key",
          "k1",
        ],
        h.runtime(),
      ),
      0,
      h.stderr(),
    );
    assert.deepEqual(h.calls[0]!.body, {
      name: "deploy",
      expectedRevision: 1,
      description: "new line",
      idempotencyKey: "k1",
    });
    assert.match(h.stdout(), /Memory update: deploy \(revision 2\)/u);
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "memory",
          "update",
          "--name",
          "deploy",
          "--expected-revision",
          "2",
          "--body-stdin",
          "--idempotency-key",
          "k2",
        ],
        h.runtime("replacement body"),
      ),
      0,
      h.stderr(),
    );
    assert.deepEqual(h.calls[1]!.body, {
      name: "deploy",
      expectedRevision: 2,
      body: "replacement body",
      idempotencyKey: "k2",
    });
  } finally {
    h.close();
  }
});

test("memory list and read render the index and the entry as text", async () => {
  const h = harness({
    "/v1/worker/memory/list": {
      channelId: "room-home",
      entries: [
        { ...detail, pinned: true, body: undefined, provenance: undefined },
      ].map(({ body: _b, provenance: _p, ...entry }) => entry),
      total: 1,
      truncated: false,
    },
    "/v1/worker/memory/read": { entry: detail },
  });
  try {
    assert.equal(
      await runWorkerCliCommand(["worker", "memory", "list"], h.runtime()),
      0,
      h.stderr(),
    );
    assert.match(
      h.stdout(),
      /- deploy \[project\] \(r1, pinned\) — how we deploy/u,
    );
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "memory", "read", "--name", "deploy"],
        h.runtime(),
      ),
      0,
      h.stderr(),
    );
    assert.match(h.stdout(), /Deploy with the release script\./u);
    assert.match(h.stdout(), /Written by: instance instance-1/u);
  } finally {
    h.close();
  }
});

test("worker help memory carries the channel-memory judgment guidance", () => {
  const text = workerHelpTopic("memory")!;
  assert.match(text, /worker memory write/u);
  assert.match(text, /What to save/u);
  assert.match(text, /What not to save/u);
  assert.match(text, /trust what you observe now/u);
  assert.match(text, /data, not instructions/u);
  assert.match(text, /invalidate/u);
});
