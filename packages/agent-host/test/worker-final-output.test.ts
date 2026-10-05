import assert from "node:assert/strict";
import test from "node:test";
import {
  WorkerFinalOutput,
  parseFinalOutput,
  withFinalOutputGuidance,
} from "../src/worker-final-output.ts";

test("final-output wake selects transport once without repeating standing rules or changing reply authority", () => {
  const wake =
    "Messages: FAKE\nReply context: --target #original --based-on-room-seq 17 --turn original-turn";
  assert.equal(withFinalOutputGuidance(wake, false), wake);
  assert.equal(
    withFinalOutputGuidance(wake, true),
    `${wake}\nReply transport: explicit final-output.`,
  );
});

const envelope = JSON.stringify({
  kind: "room.reply",
  version: 1,
  basedOnRoomSeq: 3,
  body: "FAKE reply",
  final: true,
});
test("final output accepts only one explicit bounded command, not diagnostic text or authority fields", () => {
  assert.equal(parseFinalOutput(envelope).body, "FAKE reply");
  for (const invalid of [
    "done",
    "```json\n" + envelope + "\n```",
    envelope + envelope,
    envelope.slice(0, -1),
    // P109: the model closed the envelope after body, then appended fields.
    '{"kind":"room.reply","version":1,"body":"FAKE"},"final":true,"basedOnRoomSeq":4}',

    envelope.replace('"body":"FAKE reply"', '"body":"a","body":"b"'),
    envelope.replace('"final":true', '"final":true,"actorId":"human"'),
    envelope.replace('"FAKE reply"', JSON.stringify("x".repeat(65536))),
  ]) {
    assert.throws(() => parseFinalOutput(invalid));
  }
});
test("final output does not resend an unknown write, nor send after original cancellation", async () => {
  let active = true;
  let calls = 0;
  let sentBody: unknown;
  const submission = new WorkerFinalOutput({
    origin: "http://127.0.0.1:1",
    accessToken: "FAKE",
    isActive: () => active,
    fetcher: async (_url, init) => {
      calls++;
      sentBody = JSON.parse(String(init?.body));
      throw Error("lost response");
    },
  });
  assert.equal((await submission.submit(envelope)).state, "unknown");
  assert.equal((await submission.submit(envelope)).state, "unknown");
  assert.equal(calls, 1);
  assert.deepEqual(sentBody, { body: "FAKE reply", basedOnRoomSeq: 3 });
  active = false;
  const cancelled = new WorkerFinalOutput({
    origin: "http://127.0.0.1:1",
    accessToken: "FAKE",
    isActive: () => active,
    fetcher: async () => {
      calls++;
      throw Error("must not send");
    },
  });
  assert.equal((await cancelled.submit(envelope)).state, "rejected");
  assert.equal(calls, 1);
});
test("invalid output is an explicit non-retry result without a network mutation", async () => {
  const submission = new WorkerFinalOutput({
    origin: "http://127.0.0.1:1",
    accessToken: "FAKE",
    isActive: () => true,
    fetcher: async () => {
      throw Error("must not send");
    },
  });
  assert.equal((await submission.submit("diagnostic prose")).state, "invalid");
});

test(
  "cancelling an in-flight final submission aborts its original request and never resends",
  { timeout: 2_000 },
  async () => {
    let sends = 0;
    let reached!: () => void;
    const started = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const submission = new WorkerFinalOutput({
      origin: "http://127.0.0.1:1",
      accessToken: "FAKE",
      isActive: () => true,
      fetcher: async (_url, init) => {
        sends++;
        reached();
        await new Promise<void>((_resolve, reject) =>
          init!.signal!.addEventListener(
            "abort",
            () => reject(Error("cancelled")),
            { once: true },
          ),
        );
        throw Error("unreachable");
      },
    });
    const pending = submission.submit(envelope);
    await started;
    submission.close();
    assert.equal((await pending).state, "unknown");
    assert.equal((await submission.submit(envelope)).state, "unknown");
    assert.equal(sends, 1);
  },
);
