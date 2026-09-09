import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { runWorkerCliCommand } from "../src/index.ts";

test("self profile CLI uses explicit control-Room revision context without auto-fetching or actor selection", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-self-profile-cli-"));
  const token = join(directory, "token");
  writeFileSync(token, "test-private", { mode: 0o600 });
  const calls: Array<{ path: string; body: unknown }> = [];
  let errors = "";
  const runtime = {
    env: {
      RAH_ACTIVATION_ID: "activation",
      RAH_WORKER_API_URL: "http://127.0.0.1:43001",
      RAH_WORKER_SESSION_FILE: token,
    },
    fetch: async (path: string, input: RequestInit) => {
      calls.push({ path, body: JSON.parse(String(input.body)) });
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
    assert.equal(
      await runWorkerCliCommand(["worker", "profile-self-get"], runtime),
      0,
      errors,
    );
    assert.deepEqual(calls[0], {
      path: "http://127.0.0.1:43001/v1/worker/profile/self/get",
      body: {},
    });
    const update = [
      "worker",
      "profile-update",
      "--control-room-id",
      "control",
      "--control-room-seq",
      "17",
      "--expected-revision-id",
      "revision",
      "--display-name",
      "Visible name",
      "--description",
      "Visible description",
      "--idempotency-key",
      "update",
    ];
    assert.equal(await runWorkerCliCommand(update, runtime), 0, errors);
    assert.equal(
      calls.length,
      2,
      "update must not silently fetch a newer revision",
    );
    assert.deepEqual(calls[1], {
      path: "http://127.0.0.1:43001/v1/worker/profile/self/update",
      body: {
        writeContext: {
          controlRoomId: "control",
          controlRoomSeq: 17,
          expectedRevisionId: "revision",
        },
        idempotencyKey: "update",
        patch: {
          displayName: "Visible name",
          description: "Visible description",
        },
      },
    });
    assert.equal(
      await runWorkerCliCommand([...update, "--actor-id", "other"], runtime),
      1,
    );
    // Raft's `profile update` carries no write context at all; the minimal form
    // now sends the patch alone and the server resolves the rest.
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "profile-update", "--display-name", "Implicit revision"],
        runtime,
      ),
      0,
      errors,
    );
    assert.deepEqual(calls[2], {
      path: "http://127.0.0.1:43001/v1/worker/profile/self/update",
      body: { patch: { displayName: "Implicit revision" } },
    });
    assert.equal(calls.length, 3);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("profile avatar publish sends the exact explicit file as one binary PUT", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-avatar-cli-"));
  const token = join(directory, "token"),
    file = join(directory, "avatar.png"),
    bytes = Buffer.from("explicit-image-fixture");
  writeFileSync(token, "test-private", { mode: 0o600 });
  writeFileSync(file, bytes);
  const calls: Array<{
    path: string;
    method: string | undefined;
    type: string | null;
    body: Buffer;
  }> = [];
  let errors = "";
  const runtime = {
    env: {
      RAH_ACTIVATION_ID: "activation",
      RAH_WORKER_API_URL: "http://127.0.0.1:43001",
      RAH_WORKER_SESSION_FILE: token,
    },
    fetch: async (path: string, input: RequestInit) => {
      calls.push({
        path,
        method: input.method,
        type: new Headers(input.headers).get("content-type"),
        body: Buffer.from(await new Response(input.body).arrayBuffer()),
      });
      return new Response(
        JSON.stringify({
          avatarKey: `upload_png_${"a".repeat(40)}`,
          mimeType: "image/png",
          size: bytes.length,
          uploadIntentId: "intent",
        }),
      );
    },
    stdout: { write() {} },
    stderr: {
      write(value: string) {
        errors += value;
      },
    },
  };
  try {
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "profile-avatar-publish",
          "--path",
          file,
          "--mime-type",
          "image/png",
        ],
        runtime,
      ),
      0,
      errors,
    );
    assert.deepEqual(calls, [
      {
        path: "http://127.0.0.1:43001/v1/worker/profile/self/avatar",
        method: "PUT",
        type: "image/png",
        body: bytes,
      },
    ]);
    writeFileSync(file, Buffer.alloc(5 * 1024 * 1024 + 1));
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "profile-avatar-publish",
          "--path",
          file,
          "--mime-type",
          "image/png",
        ],
        runtime,
      ),
      1,
    );
    assert.match(
      errors,
      /avatar must be a regular file between 1 and 5242880 bytes/u,
    );
    assert.equal(calls.length, 1, "oversized avatar must fail before upload");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
