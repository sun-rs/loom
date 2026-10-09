import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  writeFile,
  rm,
  access,
  symlink,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkerMessagePresentResponse } from "@rah-os/protocol";
import type { ActivationEnvelope } from "../src/runtime.ts";
import { createKimiNativeFinalTransport } from "../src/kimi-native-final-lease.ts";
const input = { runAttemptId: "run" } as ActivationEnvelope;
const present = {
  fromSeq: 4,
  toSeq: 4,
  presentedThroughSeq: 4,
  noticeCount: 0,
  contentDigest: `sha256:${"a".repeat(64)}`,
  presentedSeqs: [4],
  renderedAt: "2026-10-09T00:00:00.000Z",
  events: [
    {
      type: "message.posted",
      roomSeq: 4,
      payload: { body: "work" },
      eventId: "event",
      roomId: "room",
      actorId: "human",
      aggregateType: "message",
      aggregateId: "message",
      idempotencyKey: "key",
      schemaVersion: 1,
      createdAt: "2026-10-09T00:00:00.000Z",
    },
  ],
} as WorkerMessagePresentResponse;
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "kimi-lease-"));
  const token = join(dir, "token");
  await writeFile(token, "FAKE-original-token", { mode: 0o600 });
  let releases = 0;
  const t = createKimiNativeFinalTransport();
  const lease = await t.prepare(input, {
    env: {
      RAH_WORKER_API_URL: "http://127.0.0.1:1",
      RAH_WORKER_SESSION_FILE: token,
    },
    release: () => {
      releases++;
    },
  });
  const value = (arg: string) => lease.args![lease.args!.indexOf(arg) + 1]!;
  const proof = value("--final-proof-file");
  const candidate = {
    launchId: value("--launch-id"),
    sessionId: "session",
    turnId: "session/prompt#7",
    nativeMessageId: "response",
    text: "final",
  };
  function bind() {
    t.presented(input, present);
    t.session(input, {
      protocol: "rah-provider-session/v1",
      provider: "kimi-acp/v1",
      providerSessionId: "session",
      state: "ready",
    });
    t.accepted(input, {
      protocol: "rah-delivery-accepted/v1",
      provider: "kimi-acp/v1",
      signal: "acp-turn-update",
      threadId: "session",
      turnId: "session/prompt#7",
      inputSha256: "a".repeat(64),
    });
  }
  return {
    dir,
    token,
    t,
    lease,
    proof,
    candidate,
    bind,
    releases: () => releases,
    async close() {
      await lease.release?.();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
test("unselected wake has no native publication and cleanup is exactly once", async () => {
  const s = await setup();
  try {
    assert.equal(s.t.suffix(input), "");
    assert.equal(
      await s.lease.settleFinalOutput!(
        { code: 0 },
        new AbortController().signal,
      ),
      undefined,
    );
    await s.lease.release?.();
    await s.lease.release?.();
    assert.equal(s.releases(), 1);
    await assert.rejects(access(s.proof));
    assert.equal(s.t.suffix(input), "");
  } finally {
    await s.close();
  }
});
test("original credential and exact proof submit once; unknown response is never resent", async (ctx) => {
  const s = await setup();
  let calls = 0;
  ctx.mock.method(
    globalThis,
    "fetch",
    async (_u: unknown, init: RequestInit) => {
      calls++;
      assert.equal(
        (init.headers as Record<string, string>).authorization,
        "Bearer FAKE-original-token",
      );
      assert.deepEqual(JSON.parse(String(init.body)), {
        body: "final",
        basedOnRoomSeq: 4,
      });
      throw Error("lost response");
    },
  );
  try {
    s.bind();
    assert.match(s.t.suffix(input), /native-final-text/);
    await writeFile(s.proof, JSON.stringify(s.candidate), { mode: 0o600 });
    assert.equal(
      (
        await s.lease.settleFinalOutput!(
          { code: 0 },
          new AbortController().signal,
        )
      )?.state,
      "unknown",
    );
    assert.equal(
      (
        await s.lease.settleFinalOutput!(
          { code: 0 },
          new AbortController().signal,
        )
      )?.state,
      "unknown",
    );
    assert.equal(calls, 1);
  } finally {
    await s.close();
  }
});
test("wrong proof binding, untrusted file, cancellation and abnormal exit never send", async (ctx) => {
  ctx.mock.method(globalThis, "fetch", async () => {
    assert.fail("unexpected mutation");
  });
  for (const mode of [
    "launch",
    "session",
    "turn",
    "symlink",
    "public",
    "abnormal",
    "abort",
  ]) {
    const s = await setup();
    try {
      s.bind();
      const p = { ...s.candidate };
      if (mode === "launch") p.launchId = "old";
      if (mode === "session") p.sessionId = "other";
      if (mode === "turn") p.turnId = "old";
      await writeFile(s.proof, JSON.stringify(p), { mode: 0o600 });
      if (mode === "public") await chmod(s.proof, 0o644);
      if (mode === "symlink") {
        await rm(s.proof);
        await symlink(s.token, s.proof);
      }
      const ac = new AbortController();
      if (mode === "abort") ac.abort();
      const receipt = await s.lease.settleFinalOutput!(
        { code: mode === "abnormal" ? 1 : 0 },
        ac.signal,
      );
      assert.ok(["invalid", "rejected"].includes(receipt!.state));
    } finally {
      await s.close();
    }
  }
});
test("missing or insecure original credential fails closed and releases original lease", async () => {
  let released = 0;
  await assert.rejects(
    createKimiNativeFinalTransport().prepare(input, {
      env: {},
      release: () => {
        released++;
      },
    }),
  );
  assert.equal(released, 1);
});

test("credential symlink/public mode cannot be loaded into a final transport", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kimi-token-"));
  try {
    const token = join(dir, "token");
    await writeFile(token, "FAKE", { mode: 0o644 });
    for (const path of [token, join(dir, "link")]) {
      if (path !== token) await symlink(token, path);
      let releases = 0;
      await assert.rejects(
        createKimiNativeFinalTransport().prepare(input, {
          env: {
            RAH_WORKER_API_URL: "http://127.0.0.1:1",
            RAH_WORKER_SESSION_FILE: path,
          },
          release: () => {
            releases++;
          },
        }),
      );
      assert.equal(releases, 1);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("conflicting acceptance before session evidence poisons this original launch", async () => {
  const s = await setup();
  try {
    const evidence = {
      protocol: "rah-delivery-accepted/v1",
      provider: "kimi-acp/v1",
      signal: "acp-turn-update",
      threadId: "first",
      turnId: "session/prompt#7",
    } as const;
    s.t.accepted(input, evidence);
    assert.throws(() =>
      s.t.accepted(input, { ...evidence, threadId: "second" }),
    );
  } finally {
    await s.close();
  }
});
