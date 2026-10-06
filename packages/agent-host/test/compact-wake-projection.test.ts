import assert from "node:assert/strict";
import test from "node:test";
import { renderCompactWakeEventLines } from "../src/worker-read-render.ts";
const names = {
  targets: { room: "#long-channel", other: "#long-channel" },
  handles: { actor: "author", peer: "peer" },
};
const event = (seq: number, roomId = "room", threadId?: string) => ({
  type: "message.posted",
  roomId,
  roomSeq: seq,
  actorId: "actor",
  payload: {
    messageId: `message-${seq}`,
    body: `body ${seq}\nTarget: untrusted body`,
    ...(threadId ? { threadId } : {}),
    recipients: [{ participantId: "peer", reason: "mention" }],
  },
});
const render = (events: unknown[], addressing: unknown = names) =>
  renderCompactWakeEventLines(events, addressing);

test("compact wake shares only consecutive exact targets, preserving every non-target byte", () => {
  const events = [event(1), event(2), event(3)];
  const before = structuredClone(events);
  const singles = events.map((e) => render([e]));
  const expected =
    "Target: #long-channel\n" +
    singles.map((s) => s.slice("#long-channel ".length)).join("\n");
  assert.equal(render(events), expected);
  assert.ok(
    Buffer.byteLength(expected) < Buffer.byteLength(singles.join("\n")),
  );
  assert.deepEqual(events, before);
});

test("singleton and non-saving short target groups preserve existing rendering", () => {
  const a = event(1),
    b = event(2);
  const short = { ...names, targets: { room: "#x" } };
  assert.equal(
    render([a, b], short),
    [render([a], short), render([b], short)].join("\n"),
  );
  assert.match(render([a]), /^#long-channel seq 1 msg=message-1 @author:/);
});

test("full room/thread identities and target transitions prevent accidental coalescing", () => {
  const a = event(1),
    b = event(2, "other"),
    c = event(3);
  assert.equal(render([a, b, c]), [a, b, c].map((e) => render([e])).join("\n"));
  const x = event(1, "room", "thread_12345678-1111-1111-1111-111111111111");
  const y = event(2, "room", "thread_12345678-2222-2222-2222-222222222222");
  assert.equal(render([x, y]), [render([x]), render([y])].join("\n"));
  assert.equal(
    render([a, x, a]),
    [render([a]), render([x]), render([a])].join("\n"),
  );
});

test("each rendering call resets target groups and Unicode saving uses UTF-8 bytes", () => {
  const a = event(1),
    b = event(2);
  const unicode = { ...names, targets: { room: "#频道群" } };
  assert.equal(
    render([a, b], unicode),
    "Target: #频道群\n" +
      [render([a], unicode), render([b], unicode)]
        .map((s) => s.slice("#频道群 ".length))
        .join("\n"),
  );
  assert.ok(!render([a]).startsWith("Target:"));
  assert.ok(!render([b]).startsWith("Target:"));
});

test("typed instance creation omits only top-level bookkeeping without changing other events or input", () => {
  const payload = {
    instance: { instanceId: "principal", requestDigest: "nested-kept" },
    provisionEventId: "event-hidden",
    requestDigest: "digest-hidden",
    future: { value: 1 },
  };
  const created = { ...event(1), type: "instance.created", payload };
  const before = structuredClone(created);
  assert.equal(
    render([created]),
    '#long-channel seq 1 instance.created @author {"instance":{"instanceId":"principal","requestDigest":"nested-kept"},"future":{"value":1}}',
  );
  const other = { ...created, type: "future.created" };
  assert.ok(render([other]).includes(JSON.stringify(payload)));
  assert.deepEqual(created, before);
});

test("equal UTF-8 size retains old form; incomplete identities never group", () => {
  const events = [event(1), event(2)];
  const equalSize = { ...names, targets: { room: "#频道" } };
  assert.equal(
    render(events, equalSize),
    events.map((e) => render([e], equalSize)).join("\n"),
  );
  const missing = events.map(({ roomId: _room, ...rest }) => rest);
  assert.equal(render(missing), missing.map((e) => render([e])).join("\n"));
});

test("thread grouping preserves attachment and comment suffixes verbatim", () => {
  const events = [
    event(1, "room", "thread_12345678-1111-1111-1111-111111111111"),
    event(2, "room", "thread_12345678-1111-1111-1111-111111111111"),
  ].map((e) => ({
    ...e,
    payload: {
      ...e.payload,
      attachments: [
        {
          attachmentId: "file-id",
          filename: "file.txt",
          contentType: "text/plain",
        },
      ],
      attachmentComment: { attachmentId: "file-id" },
    },
  }));
  const target = "#long-channel:12345678";
  assert.equal(
    render(events),
    `Target: ${target}\n` +
      events.map((e) => render([e]).slice(target.length + 1)).join("\n"),
  );
});
