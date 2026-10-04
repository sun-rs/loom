import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import { runWorkerCliCommand } from "../src/worker-cli.ts";

const readReceiptId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function fixture(body = "A newer explicit message", receipted = true) {
  const directory = mkdtempSync(join(tmpdir(), "loom-held-receipt-"));
  const tokenPath = join(directory, "token");
  writeFileSync(tokenPath, "fake-worker-token", { mode: 0o600 });
  const requests: Array<{ path: string; body: unknown }> = [];
  let stdout = "";
  let stderr = "";
  const result = {
    state: "held",
    heldDraftId: "held-draft",
    recoveryTarget: "#channel",
    newMessageCount: 1,
    shownMessageCount: 1,
    newerMessages: [
      {
        eventId: "event-newer",
        roomSeq: 21,
        actorId: "peer",
        type: "message.posted",
        aggregateId: "message-newer",
        payload: { body },
      },
    ],
    replyIntent: { basedOnRoomSeq: 8, final: true },
    ...(receipted ? { readReceiptId } : {}),
  };
  return {
    requests,
    result,
    stdout: () => stdout,
    stderr: () => stderr,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
    runtime: {
      env: {
        RAH_ACTIVATION_ID: "activation-test",
        RAH_WORKER_API_URL: "http://127.0.0.1:43123",
        RAH_WORKER_SESSION_FILE: tokenPath,
      },
      fetch: async (url: string, init: RequestInit) => {
        const path = new URL(url).pathname;
        requests.push({ path, body: JSON.parse(String(init.body)) });
        assert.ok(
          ["/v1/worker/messages/post", "/v1/worker/read-received"].includes(
            path,
          ),
          "held output never ACKs delivery or runs message-check",
        );
        return new Response(
          JSON.stringify(
            path.endsWith("/read-received") ? { received: true } : result,
          ),
        );
      },
      stdout: {
        write: (text: string) => {
          stdout += text;
        },
      },
      stderr: {
        write: (text: string) => {
          stderr += text;
        },
      },
    },
  };
}
const command = [
  "worker",
  "message-post",
  "--target",
  "#channel",
  "--body",
  "old reply",
  "--final",
];
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

for (const json of [false, true]) {
  test(`held ${json ? "JSON stderr" : "text stdout"} records hidden consumption only after its output callback`, async () => {
    const f = fixture();
    let finish: ((error?: Error | null) => void) | undefined;
    let output = "";
    const ready = Promise.withResolvers<void>();
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk;
        finish = callback;
        ready.resolve();
      },
    });
    stream.on("error", () => {});
    try {
      const pending = runWorkerCliCommand(
        [...command, ...(json ? ["--json"] : [])],
        { ...f.runtime, [json ? "stderr" : "stdout"]: stream },
      );
      await ready.promise;
      assert.ok(finish, "the held content has reached the output stream");
      assert.equal(
        f.requests.length,
        1,
        "HTTP return alone is not consumption",
      );
      finish();
      assert.equal(await pending, 1, "held remains an unsent draft");
      assert.deepEqual(f.requests[1], {
        path: "/v1/worker/read-received",
        body: { readReceiptId },
      });
      assert.equal(f.requests.length, 2);
      assert.ok(output.includes("A newer explicit message"));
      assert.ok(
        !output.includes(readReceiptId),
        "receipt is transport metadata, not model text",
      );
      if (json)
        assert.equal(JSON.parse(output).error.code, "SEND_HELD_AS_DRAFT");
      else assert.match(f.stderr(), /SEND_HELD_AS_DRAFT/u);
    } finally {
      f.cleanup();
    }
  });

  test(`held ${json ? "JSON" : "text"} EPIPE never confirms consumption`, async () => {
    const f = fixture();
    const stream = new Writable({
      write(_chunk, _encoding, callback) {
        setImmediate(() => callback(new Error("EPIPE")));
      },
    });
    stream.on("error", () => {});
    try {
      assert.equal(
        await runWorkerCliCommand([...command, ...(json ? ["--json"] : [])], {
          ...f.runtime,
          [json ? "stderr" : "stdout"]: stream,
        }),
        1,
      );
      await tick();
      assert.equal(f.requests.length, 1);
    } finally {
      f.cleanup();
    }
  });
}

test("text excerpts cannot confirm full newer-message bodies; full JSON output can", async () => {
  for (const json of [false, true]) {
    const f = fixture("x".repeat(501));
    try {
      assert.equal(
        await runWorkerCliCommand(
          [...command, ...(json ? ["--json"] : [])],
          f.runtime,
        ),
        1,
      );
      assert.equal(f.requests.length, json ? 2 : 1);
      assert.ok(!(f.stdout() + f.stderr()).includes(readReceiptId));
      if (!json)
        assert.ok(
          !f.stdout().includes("x".repeat(501)),
          "existing bounded guidance remains bounded",
        );
    } finally {
      f.cleanup();
    }
  }
});

test("legacy held results without a read receipt remain unsent and do not confirm consumption", async () => {
  const f = fixture("A newer explicit message", false);
  try {
    assert.equal(await runWorkerCliCommand(command, f.runtime), 1);
    assert.equal(f.requests.length, 1);
    assert.match(f.stdout(), /message was NOT sent/u);
  } finally {
    f.cleanup();
  }
});

test("a held output receipt rejection is visible and never retries the post", async () => {
  const f = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand(command, {
        ...f.runtime,
        fetch: async (url, init) => {
          const response = await f.runtime.fetch(url, init);
          return url.endsWith("/read-received")
            ? new Response(JSON.stringify({ received: false }))
            : response;
        },
      }),
      1,
    );
    assert.equal(f.requests.length, 2);
    assert.match(f.stderr(), /consumption remains unconfirmed/u);
    assert.match(f.stderr(), /Code: SEND_HELD_AS_DRAFT/u);
    assert.match(f.stderr(), /Effect: draft_saved/u);
  } finally {
    f.cleanup();
  }
});

test("a timed-out held output never sends a late receipt", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  let finish: ((error?: Error | null) => void) | undefined;
  const ready = Promise.withResolvers<void>();
  const stdout = new Writable({
    write(_chunk, _encoding, callback) {
      finish = callback;
      ready.resolve();
    },
  });
  stdout.on("error", () => {});
  try {
    const pending = runWorkerCliCommand(command, { ...f.runtime, stdout });
    await ready.promise;
    assert.ok(finish);
    t.mock.timers.tick(10_001);
    assert.equal(await pending, 1);
    finish();
    await tick();
    assert.equal(f.requests.length, 1);
    assert.match(f.stderr(), /consumption remains unconfirmed/u);
  } finally {
    f.cleanup();
  }
});

test("text held guidance does not confirm attachment metadata it never renders", async () => {
  const f = fixture();
  Object.assign(f.result.newerMessages[0]!.payload, {
    attachments: [{ attachmentId: "file-hidden", filename: "evidence.txt" }],
  });
  try {
    assert.equal(await runWorkerCliCommand(command, f.runtime), 1);
    assert.equal(f.requests.length, 1);
  } finally {
    f.cleanup();
  }
});

test("a lost JSON receipt keeps the original held envelope and never resends the post", async () => {
  const f = fixture();
  try {
    assert.equal(
      await runWorkerCliCommand([...command, "--json"], {
        ...f.runtime,
        fetch: async (url, init) => {
          const response = await f.runtime.fetch(url, init);
          if (url.endsWith("/read-received"))
            throw new Error("receipt transport lost");
          return response;
        },
      }),
      1,
    );
    assert.equal(f.requests.length, 2);
    const lines = f
      .stderr()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(lines[0].error.code, "SEND_HELD_AS_DRAFT");
    assert.equal(lines[0].error.effect, "draft_saved");
    assert.equal(lines[1].error.code, "SEND_HELD_AS_DRAFT");
    assert.equal(lines[1].error.retryable, false);
    assert.match(lines[1].error.message, /consumption remains unconfirmed/u);
    assert.ok(!f.stderr().includes(readReceiptId));
    assert.equal(f.stdout(), "");
  } finally {
    f.cleanup();
  }
});

test("receipt errors cannot reflect hidden receipt IDs or arbitrary server text to the model", async () => {
  for (const json of [false, true]) {
    const f = fixture();
    try {
      assert.equal(
        await runWorkerCliCommand([...command, ...(json ? ["--json"] : [])], {
          ...f.runtime,
          fetch: async (url, init) => {
            const response = await f.runtime.fetch(url, init);
            if (url.endsWith("/read-received"))
              throw new Error(
                `rejected receipt ${readReceiptId}: private backend detail`,
              );
            return response;
          },
        }),
        1,
      );
      assert.equal(f.requests.length, 2);
      const output = f.stdout() + f.stderr();
      assert.match(output, /consumption remains unconfirmed/u);
      assert.ok(!output.includes(readReceiptId));
      assert.ok(!output.includes("private backend detail"));
      assert.match(output, /SEND_HELD_AS_DRAFT/u);
    } finally {
      f.cleanup();
    }
  }
});
