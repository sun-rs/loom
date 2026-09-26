import assert from "node:assert/strict";
import test from "node:test";

import { FakeRahClient, RahClientError } from "@rah-os/client-sdk";

import {
  STALE_RETRY_ATTEMPTS,
  WriteIntentSlot,
  classifyWriteFailure,
  type IntentState,
} from "../src/actions.ts";

// FIXTURE ONLY: every identifier and reply below is fake test data.
const NOW = "2026-09-26T12:00:00.000Z";

/**
 * A fake Loom server with the Kernel's replay-first idempotency: a known key
 * replays when the authored request matches (and conflicts otherwise), a new
 * key must be based on the current head. `digestSeq` mirrors role.create /
 * role.instantiate, whose request digest includes `basedOnRoomSeq`.
 * `loseNextResponse` commits the write and then drops its response.
 */
function fakeServer(options: { digestSeq: boolean }) {
  let head = 10;
  const committed = new Map<string, { digest: string; seq: number }>();
  const sent: Array<{ basedOnRoomSeq: number; body: string; key: string }> = [];
  const control = {
    advanceHead: () => {
      head += 1;
    },
    committed,
    get head() {
      return head;
    },
    loseNextResponse: false,
    refuseNext: undefined as RahClientError | undefined,
    sent,
  };
  const client = new FakeRahClient(async (operation, input) => {
    if (operation !== "message.post")
      throw new Error(`unexpected ${operation}`);
    const request = input as {
      basedOnRoomSeq: number;
      body: string;
      idempotencyKey: string;
      roomId: string;
    };
    sent.push({
      basedOnRoomSeq: request.basedOnRoomSeq,
      body: request.body,
      key: request.idempotencyKey,
    });
    if (control.refuseNext !== undefined) {
      const refusal = control.refuseNext;
      control.refuseNext = undefined;
      throw refusal;
    }
    const digest = options.digestSeq
      ? `${request.body}@${String(request.basedOnRoomSeq)}`
      : request.body;
    const prior = committed.get(request.idempotencyKey);
    let seq: number;
    let deduplicated = false;
    if (prior !== undefined) {
      if (prior.digest !== digest) {
        throw new RahClientError("idempotency_conflict", "key reused", 409);
      }
      seq = prior.seq;
      deduplicated = true;
    } else {
      if (request.basedOnRoomSeq !== head) {
        throw new RahClientError("stale_context", "newer facts", 409);
      }
      head += 1;
      seq = head;
      committed.set(request.idempotencyKey, { digest, seq });
    }
    if (control.loseNextResponse) {
      control.loseNextResponse = false;
      throw new TypeError("Failed to fetch (FIXTURE response lost)");
    }
    return {
      activationIds: [],
      deduplicated,
      event: {
        actorId: "principal-human-fixture",
        aggregateId: `message-${String(seq)}`,
        aggregateType: "message",
        createdAt: NOW,
        eventId: `event-${String(seq)}`,
        idempotencyKey: request.idempotencyKey,
        payload: { body: request.body },
        roomId: request.roomId,
        roomSeq: seq,
        schemaVersion: 1,
        type: "message.posted",
      },
    } as never;
  });
  const session = {
    async syncUntilCurrent() {
      return { caughtUp: true, state: { latestRoomSeq: head } };
    },
  };
  return { client, control, session };
}

function post(
  server: ReturnType<typeof fakeServer>,
  payload: { body: string },
) {
  return {
    action: "message",
    payload,
    send: (
      frozen: Readonly<{ body: string }>,
      basedOnRoomSeq: number,
      idempotencyKey: string,
    ) =>
      server.client.request("message.post", {
        basedOnRoomSeq,
        body: frozen.body,
        idempotencyKey,
        recipients: [],
        roomId: "room-a",
      }),
    session: server.session,
  };
}

test("only an explicit 4xx refusal is a rejection; network errors, timeouts and 5xx leave the result unknown", () => {
  assert.equal(
    classifyWriteFailure(new RahClientError("forbidden", "no", 403)),
    "rejected",
  );
  assert.equal(
    classifyWriteFailure(new RahClientError("stale_context", "newer", 409)),
    "rejected",
  );
  assert.equal(
    classifyWriteFailure(new RahClientError("timeout", "slow", 408)),
    "unknown",
  );
  assert.equal(
    classifyWriteFailure(new RahClientError("internal", "boom", 500)),
    "unknown",
  );
  assert.equal(
    classifyWriteFailure(new RahClientError("http_error", "bad gateway", 502)),
    "unknown",
  );
  assert.equal(
    classifyWriteFailure(
      new RahClientError("invalid_response", "malformed", 200),
    ),
    "unknown",
    "a committed write whose response cannot be parsed is not a refusal",
  );
  assert.equal(
    classifyWriteFailure(new TypeError("Failed to fetch")),
    "unknown",
  );
  assert.equal(
    classifyWriteFailure(new DOMException("timed out", "TimeoutError")),
    "unknown",
  );
});

for (const digestSeq of [false, true]) {
  test(`a write committed before its response was lost is retried with the same key, payload and basis and takes effect once (digest includes basedOnRoomSeq: ${String(digestSeq)})`, async () => {
    const server = fakeServer({ digestSeq });
    const slot = new WriteIntentSlot();
    const states: IntentState[] = [];
    slot.onChange((state) => states.push(state));
    const settled: string[] = [];
    server.control.loseNextResponse = true;
    const first = await slot.submit({
      ...post(server, { body: "FIXTURE hello" }),
      onSettled: (outcome) => settled.push(outcome.kind),
    });
    assert.equal(first.kind, "unknown");
    assert.equal(slot.state, "unknown");
    assert.equal(server.control.committed.size, 1, "the server committed it");

    // A new intent is refused until the unknown one is resolved.
    const refused = await slot.submit(post(server, { body: "FIXTURE other" }));
    assert.deepEqual(refused, { kind: "busy", state: "unknown" });
    assert.equal(server.control.sent.length, 1, "nothing new was sent");

    // Other writes land meanwhile; the retry still replays the original.
    server.control.advanceHead();
    const retried = await slot.retry();
    assert.equal(retried.kind, "ok");
    assert.equal(
      (retried as { result: { deduplicated: boolean } }).result.deduplicated,
      true,
    );
    assert.equal(slot.state, "idle");
    assert.equal(server.control.committed.size, 1, "exactly one effect");
    assert.equal(server.control.sent.length, 2);
    assert.deepEqual(
      server.control.sent[1],
      server.control.sent[0],
      "the retry resends the identical request (key, body, basis)",
    );
    assert.deepEqual(settled, ["unknown", "ok"]);
    assert.deepEqual(states, ["pending", "unknown", "pending", "idle"]);

    // Only now may a new intent start, with a new key.
    const next = await slot.submit(post(server, { body: "FIXTURE next" }));
    assert.equal(next.kind, "ok");
    assert.notEqual(
      server.control.sent.at(-1)!.key,
      server.control.sent[0]!.key,
    );
    assert.equal(server.control.committed.size, 2);
  });
}

test("an unknown write that never committed is retried under the same key after re-syncing", async () => {
  const server = fakeServer({ digestSeq: true });
  const slot = new WriteIntentSlot();
  server.control.refuseNext = new RahClientError("unavailable", "down", 503);
  const first = await slot.submit(post(server, { body: "FIXTURE lost" }));
  assert.equal(first.kind, "unknown");
  assert.equal(server.control.committed.size, 0);
  server.control.advanceHead();
  const retried = await slot.retry();
  assert.equal(retried.kind, "ok");
  const keys = new Set(server.control.sent.map(({ key }) => key));
  assert.equal(keys.size, 1, "one key for the whole intent");
  assert.deepEqual(
    server.control.sent.map(({ basedOnRoomSeq }) => basedOnRoomSeq),
    [10, 10, 11],
    "the stale replay re-syncs to the new head",
  );
  assert.equal(server.control.committed.size, 1);
});

test("stale retries keep the frozen payload even when the caller's draft changes meanwhile", async () => {
  const server = fakeServer({ digestSeq: false });
  const slot = new WriteIntentSlot();
  const draft = { body: "FIXTURE original" };
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = slot.submit({
    ...post(server, draft),
    session: {
      async syncUntilCurrent() {
        await gate;
        return server.session.syncUntilCurrent();
      },
    },
  });
  assert.equal(slot.state, "pending");
  draft.body = "FIXTURE edited while pending";
  // Two stale refusals before it lands.
  let staleLeft = 2;
  const originalHead = server.control.head;
  const realSend = server.client.request.bind(server.client);
  server.client.request = (async (operation: never, input: never) => {
    if (staleLeft > 0) {
      staleLeft -= 1;
      server.control.advanceHead();
    }
    return await realSend(operation, input);
  }) as typeof server.client.request;
  release();
  const outcome = await pending;
  assert.equal(outcome.kind, "ok");
  assert.equal(server.control.sent.length, STALE_RETRY_ATTEMPTS);
  assert.deepEqual(
    server.control.sent.map(({ body }) => body),
    ["FIXTURE original", "FIXTURE original", "FIXTURE original"],
  );
  assert.equal(new Set(server.control.sent.map(({ key }) => key)).size, 1);
  assert.ok(server.control.head > originalHead);
});

test("an explicit refusal ends the intent so the Human can start a new one; a failure before sending is not unknown", async () => {
  const server = fakeServer({ digestSeq: false });
  const slot = new WriteIntentSlot();
  server.control.refuseNext = new RahClientError(
    "forbidden",
    "not a member",
    403,
  );
  const refused = await slot.submit(post(server, { body: "FIXTURE a" }));
  assert.equal(refused.kind, "rejected");
  assert.equal(slot.state, "idle");

  const offline = await slot.submit({
    ...post(server, { body: "FIXTURE b" }),
    session: {
      async syncUntilCurrent(): Promise<never> {
        throw new TypeError("Failed to fetch (FIXTURE offline sync)");
      },
    },
  });
  assert.equal(
    offline.kind,
    "rejected",
    "nothing was sent, so nothing committed",
  );
  assert.equal(slot.state, "idle");
  assert.equal(server.control.sent.length, 1);
});

test("abandoning an unknown intent allows a new one; retry and abandon only act on an unknown intent", async () => {
  const server = fakeServer({ digestSeq: false });
  const slot = new WriteIntentSlot();
  assert.equal(slot.abandon(), false);
  assert.deepEqual(await slot.retry(), { kind: "busy", state: "idle" });
  server.control.loseNextResponse = true;
  await slot.submit(post(server, { body: "FIXTURE unknown" }));
  assert.equal(slot.state, "unknown");
  assert.equal(slot.current?.action, "message");
  assert.deepEqual(slot.current?.payload, { body: "FIXTURE unknown" });
  assert.equal(slot.abandon(), true);
  assert.equal(slot.state, "idle");
  assert.equal(slot.current, undefined);
  const next = await slot.submit(post(server, { body: "FIXTURE after" }));
  assert.equal(next.kind, "ok");
});

test("one pending intent refuses a second submit and a retry", async () => {
  const server = fakeServer({ digestSeq: false });
  const slot = new WriteIntentSlot();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = slot.submit({
    ...post(server, { body: "FIXTURE first" }),
    session: {
      async syncUntilCurrent() {
        await gate;
        return server.session.syncUntilCurrent();
      },
    },
  });
  assert.deepEqual(await slot.submit(post(server, { body: "FIXTURE 2" })), {
    kind: "busy",
    state: "pending",
  });
  assert.deepEqual(await slot.retry(), { kind: "busy", state: "pending" });
  release();
  assert.equal((await first).kind, "ok");
  assert.equal(server.control.committed.size, 1);
});
