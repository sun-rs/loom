import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { RoomKernel } from "../src/index.ts";

/**
 * Owner ruling 2026-09-27 (contract §3): a Human message's recipients are a
 * message-level set, never split by where an @ sits in the text. When the
 * message's canonical mentions name enabled instance members of the Channel,
 * only those are woken; the others get no Inbox item, Activation or Outbox
 * work and read the message later from the Room. No such mention (none, a
 * non-member, a Human, a typo, an @ inside code) keeps the broadcast, and an
 * explicit `@all` / `@所有人` always broadcasts. Threads follow the same rule.
 */

test("a Human @ of one instance wakes only that instance", () => {
  const state = fixture(["alpha", "beta", "gamma"]);
  try {
    const posted = post(state, "@alpha please review the receipt", "one");
    assert.deepEqual(woken(state, posted), [["alpha", "mention"]]);
    for (const handle of ["beta", "gamma"])
      assert.equal(inboxFor(state, posted, handle), 0, `${handle} not woken`);
    assert.equal(
      outboxWakes(state, posted),
      1,
      "only the addressed instance gets activation.requested",
    );
  } finally {
    state.close();
  }
});

test("a Human @ of several instances wakes each named instance once", () => {
  const state = fixture(["alpha", "beta", "gamma"]);
  try {
    const posted = post(
      state,
      "@alpha take the writer, @beta the tests, and @alpha also the docs",
      "several",
    );
    assert.deepEqual(woken(state, posted), [
      ["alpha", "mention"],
      ["beta", "mention"],
    ]);
  } finally {
    state.close();
  }
});

test("a Human message without an instance @ still wakes every instance", () => {
  const state = fixture(["alpha", "beta", "gamma"]);
  try {
    const plain = post(state, "Everyone, what do you think?", "plain");
    assert.deepEqual(woken(state, plain), [
      ["alpha", "room_policy"],
      ["beta", "room_policy"],
      ["gamma", "room_policy"],
    ]);
  } finally {
    state.close();
  }
});

test("@all and @所有人 broadcast even alongside a named instance", () => {
  const state = fixture(["alpha", "beta", "gamma"]);
  try {
    for (const [key, body] of [
      ["all", "@all please read this; @alpha you own the fix"],
      ["all-zh", "@所有人 看一下，@beta 负责测试"],
    ] as const) {
      const posted = post(state, body, key);
      assert.deepEqual(
        woken(state, posted).map(([handle]) => handle),
        ["alpha", "beta", "gamma"],
        body,
      );
    }
  } finally {
    state.close();
  }
});

test("an @ that names no instance member falls back to broadcast", () => {
  const state = fixture(["alpha", "beta"]);
  try {
    state.kernel.provisionPrincipal({ handle: "outsider", kind: "agent" });
    for (const [key, body] of [
      ["non-member", "@outsider can you look?"],
      ["human-only", "@owner note to self"],
      ["typo", "@alpah please look"],
    ] as const) {
      const posted = post(state, body, key);
      assert.deepEqual(
        woken(state, posted).map(([handle]) => handle),
        ["alpha", "beta"],
        body,
      );
    }
  } finally {
    state.close();
  }
});

test("an @ inside code, a link or an email address is not an address", () => {
  const state = fixture(["alpha", "beta"]);
  try {
    for (const [key, body] of [
      ["inline", "the handle is `@alpha` here"],
      ["fence", "see\n```\n@alpha run\n```\n"],
      ["link", "[@alpha](https://example.test/@alpha)"],
      ["email", "mail me at me@alpha.test"],
    ] as const) {
      const posted = post(state, body, key);
      assert.deepEqual(
        woken(state, posted).map(([handle]) => handle),
        ["alpha", "beta"],
        body,
      );
    }
  } finally {
    state.close();
  }
});

test("facade-supplied recipients cannot widen a Human @", () => {
  const state = fixture(["alpha", "beta"]);
  try {
    const posted = state.kernel.postRoomMessage(state.humanActor, {
      body: "@alpha only you",
      idempotencyKey: "widen",
      recipients: [
        { participantId: state.agents.beta!.principalId, reason: "mention" },
      ],
      roomId: state.room.roomId,
    });
    assert.deepEqual(woken(state, posted), [["alpha", "mention"]]);
  } finally {
    state.close();
  }
});

test("a Human @ does not extend another instance's queued Activation", () => {
  const state = fixture(["alpha", "beta"]);
  try {
    post(state, "first, for everyone", "first");
    const before = queuedToSeq(state, "beta");
    const addressed = post(state, "@alpha just you", "second");
    assert.equal(queuedToSeq(state, "beta"), before);
    assert.equal(queuedToSeq(state, "alpha"), addressed.event.roomSeq);
  } finally {
    state.close();
  }
});

test("a replayed Human @ derives nothing more", () => {
  const state = fixture(["alpha", "beta"]);
  try {
    const first = post(state, "@alpha once", "replay");
    const again = post(state, "@alpha once", "replay");
    assert.equal(again.deduplicated, true);
    assert.equal(first.event.eventId, again.event.eventId);
    assert.deepEqual(woken(state, first), [["alpha", "mention"]]);
  } finally {
    state.close();
  }
});

test("a Human Thread reply with @ wakes only the named instances, followers or not", () => {
  const state = fixture(["alpha", "beta", "gamma"]);
  try {
    const root = state.kernel.postMessage(state.humanActor, {
      body: "Thread root",
      idempotencyKey: "root",
      recipients: [],
      roomId: state.room.roomId,
    });
    const thread = state.kernel.createThread(state.humanActor, {
      basedOnRoomSeq: root.event.roomSeq,
      idempotencyKey: "thread",
      recipientIds: [
        state.agents.alpha!.principalId,
        state.agents.beta!.principalId,
      ],
      roomId: state.room.roomId,
      rootMessageId: root.event.aggregateId,
    });
    const reply = (key: string, body: string) =>
      state.kernel.replyThread(state.humanActor, {
        basedOnRoomSeq: latestSeq(state),
        body,
        idempotencyKey: key,
        recipientIds: [],
        roomId: state.room.roomId,
        threadId: thread.thread.threadId,
      });
    assert.deepEqual(
      woken(state, reply("t-alpha", "@alpha in the thread")).map(([h]) => h),
      ["alpha"],
    );
    assert.deepEqual(
      woken(state, reply("t-gamma", "@gamma join us")).map(([h]) => h),
      ["gamma"],
      "a named Channel member is woken even when not a follower",
    );
    assert.deepEqual(
      woken(state, reply("t-plain", "followers, any update?")).map(([h]) => h),
      ["alpha", "beta"],
      "without @ a Human Thread reply reaches every follower",
    );
  } finally {
    state.close();
  }
});

test("a Human @ still resets the Channel's instance chain", () => {
  const state = fixture(["alpha", "beta"]);
  try {
    const posted = post(state, "@alpha go", "reset");
    const guard = sql(
      state,
      "SELECT human_seq, streak FROM instance_wake_guards WHERE room_id = ?",
      state.room.roomId,
    )[0]!;
    assert.equal(Number(guard.human_seq), posted.event.roomSeq);
    assert.equal(Number(guard.streak), 0);
  } finally {
    state.close();
  }
});

type State = ReturnType<typeof fixture>;
type Posted = { event: { eventId: string; roomSeq: number } };

function fixture(handles: string[]) {
  const directory = mkdtempSync(join(tmpdir(), "loom-human-mention-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
  const humanActor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(humanActor, {
    name: "Human mention",
    slug: "human-mention",
  });
  const agents: Record<string, { principalId: string }> = {};
  for (const handle of handles) {
    const provisioned = kernel.provisionPrincipal({ handle, kind: "agent" });
    agents[handle] = provisioned.principal;
    kernel.addMember(humanActor, {
      principalId: provisioned.principal.principalId,
      roomId: room.roomId,
    });
  }
  return {
    agents,
    close: () => {
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    },
    databasePath,
    humanActor,
    kernel,
    room,
  };
}

function post(state: State, body: string, key: string) {
  return state.kernel.postRoomMessage(state.humanActor, {
    body,
    idempotencyKey: key,
    roomId: state.room.roomId,
  });
}

function handleOf(state: State, participantId: string): string {
  const entry = Object.entries(state.agents).find(
    ([, principal]) => principal.principalId === participantId,
  );
  assert.ok(entry, `unknown participant ${participantId}`);
  return entry[0];
}

/** Inbox items derived from the event, as sorted [handle, reason]. */
function woken(state: State, posted: Posted): Array<[string, string]> {
  return sql(
    state,
    "SELECT participant_id, reason FROM inbox_items WHERE event_id = ?",
    posted.event.eventId,
  )
    .map(
      (row) =>
        [handleOf(state, String(row.participant_id)), String(row.reason)] as [
          string,
          string,
        ],
    )
    .sort(([left], [right]) => left.localeCompare(right));
}

function inboxFor(state: State, posted: Posted, handle: string): number {
  return sql(
    state,
    "SELECT 1 FROM inbox_items WHERE event_id = ? AND participant_id = ?",
    posted.event.eventId,
    state.agents[handle]!.principalId,
  ).length;
}

function outboxWakes(state: State, posted: Posted): number {
  return sql(
    state,
    "SELECT 1 FROM outbox WHERE topic = 'activation.requested' AND room_id = ? AND room_seq = ?",
    state.room.roomId,
    String(posted.event.roomSeq),
  ).length;
}

function queuedToSeq(state: State, handle: string): number | undefined {
  const row = sql(
    state,
    "SELECT to_seq FROM activations WHERE room_id = ? AND participant_id = ? AND state = 'queued'",
    state.room.roomId,
    state.agents[handle]!.principalId,
  )[0];
  return row === undefined ? undefined : Number(row.to_seq);
}

function latestSeq(state: State): number {
  return Number(
    sql(
      state,
      "SELECT MAX(room_seq) AS seq FROM room_events WHERE room_id = ?",
      state.room.roomId,
    )[0]!.seq,
  );
}

function sql(state: State, query: string, ...parameters: string[]) {
  const database = new DatabaseSync(state.databasePath, { readOnly: true });
  try {
    return database.prepare(query).all(...parameters);
  } finally {
    database.close();
  }
}
