import assert from "node:assert/strict";
import test from "node:test";
import { validateMcpInlineRound } from "./multi-channel-mcp-validation.mjs";
const evidenceText = "complete source\n";
const receipt = {
  state: "published",
  eventId: "event-1",
  messageId: "message-1",
  roomId: "room-1",
  roomSeq: 12,
  actorId: "actor-1",
  threadId: null,
  deduplicated: false,
};
const round = {
  speaker: "a",
  sessionId: "session-a",
  answer: "exact",
  startedAt: "2026-10-05T00:00:01Z",
  finishedAt: "2026-10-05T00:00:03Z",
  humanRoomSeq: 8,
  participantId: "actor-1",
  metrics: { generations: 1 },
  runs: [{ runAttemptId: "run-1" }],
  replies: [
    {
      messageId: "message-1",
      roomId: "room-1",
      roomSeq: 12,
      actorId: "actor-1",
      body: "exact",
    },
  ],
  finalMarker: {
    submission_kind: null,
    run_attempt_id: "run-1",
    event_id: "event-1",
    room_id: "room-1",
    room_seq: 12,
  },
};
const row = (payload) => ({
  type: "response_item",
  timestamp: "2026-10-05T00:00:02Z",
  payload,
});
const call = () =>
  row({
    type: "custom_tool_call",
    name: "exec",
    call_id: "call-1",
    input:
      'const r = await tools.mcp__loom_worker__loom_reply({body:"exact", basedOnRoomSeq:8, final:true, threadId:null}); text(r);',
  });
const output = (r = receipt) =>
  row({
    type: "custom_tool_call_output",
    call_id: "call-1",
    output: [
      { type: "input_text", text: "Script completed" },
      {
        type: "input_text",
        text: JSON.stringify({
          content: [{ type: "text", text: JSON.stringify(r) }],
          isError: false,
        }),
      },
    ],
  });
const user = () =>
  row({
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: evidenceText }],
  });
const options = (changes = {}) => ({
  armKind: "worker-mcp",
  round: structuredClone(round),
  previousRounds: [],
  events: [user(), call(), output()],
  expectedAnswer: "exact",
  evidenceText,
  ...changes,
});
test("one real MCP call and correlated durable receipt establish protocol delivery", () => {
  assert.deepEqual(validateMcpInlineRound(options()), {
    answer: "exact",
    readProof: "complete-inline-input",
    replyProof: "single-mcp-final-reply",
  });
  assert.equal(
    validateMcpInlineRound(options({ armKind: "native", events: [user()] }))
      .readProof,
    "complete-inline-input",
  );
  assert.throws(
    () => validateMcpInlineRound(options({ armKind: "unknown" })),
    /arm/i,
  );
});
test("no proof from text, unrelated call, duplicate or extra tool", () => {
  for (const events of [
    [user()],
    [user(), call()],
    [user(), output()],
    [user(), call(), output(), call()],
    [user(), call(), output(), row({ type: "web_search_call" })],
  ])
    assert.throws(
      () => validateMcpInlineRound(options({ events })),
      /tool|call|result/i,
    );
  const wrong = output();
  wrong.payload.call_id = "another";
  assert.throws(
    () => validateMcpInlineRound(options({ events: [user(), call(), wrong] })),
    /correlat/i,
  );
});
test("reject shell fallback, fake receipt, namespace spoof and nonliteral arguments", () => {
  for (const input of [
    'text({state:"published"})',
    'text(await attacker.mcp__loom_worker__loom_reply({body:"exact"}))',
    'const r = await tools.exec_command({cmd:"worker message-post"}); text(r);',
    'const r = await tools.mcp__loom_worker__loom_reply(JSON.parse("{}")); text(r);',
    call().payload.input.replace("text(r)", 'text({state:"published"})'),
    call().payload.input + ' text("extra");',
  ]) {
    const c = call();
    c.payload.input = input;
    assert.throws(
      () => validateMcpInlineRound(options({ events: [user(), c, output()] })),
      /tool|literal|result|statement|emit/i,
    );
  }
});
test("arguments and receipt must match current exact action and final marker", () => {
  for (const [from, to] of [
    ["final:true", "final:false"],
    ["basedOnRoomSeq:8", "basedOnRoomSeq:7"],
    ['body:"exact"', 'body:"wrong"'],
    ["threadId:null", 'threadId:"other"'],
  ]) {
    const c = call();
    c.payload.input = c.payload.input.replace(from, to);
    assert.throws(
      () => validateMcpInlineRound(options({ events: [user(), c, output()] })),
      /argument|reply|seq|target/i,
    );
  }
  for (const changes of [
    { state: "held" },
    { eventId: "old-event" },
    { messageId: "old-message" },
    { actorId: "other" },
    { roomId: "other" },
    { roomSeq: 99 },
    { threadId: "thread" },
    { deduplicated: true },
  ])
    assert.throws(
      () =>
        validateMcpInlineRound(
          options({
            events: [user(), call(), output({ ...receipt, ...changes })],
          }),
        ),
      /receipt/i,
    );
  const r = structuredClone(round);
  r.finalMarker.submission_kind = "final-output";
  assert.throws(() => validateMcpInlineRound(options({ round: r })), /marker/i);
});
test("material, generation and time evidence remain mandatory", () => {
  assert.throws(
    () => validateMcpInlineRound(options({ events: [call(), output()] })),
    /input/i,
  );
  const c = call();
  c.timestamp = "invalid";
  assert.throws(
    () => validateMcpInlineRound(options({ events: [user(), c, output()] })),
    /time/i,
  );
  assert.throws(
    () =>
      validateMcpInlineRound(
        options({ round: { ...round, metrics: { generations: 0 } } }),
      ),
    /generation/i,
  );
});

test("accept actual optional empty receipt lists but reject new side effects", () => {
  const actual = {
    ...receipt,
    activationIds: [],
    unresolvedMentionHandles: [],
  };
  assert.equal(
    validateMcpInlineRound(
      options({ events: [user(), call(), output(actual)] }),
    ).replyProof,
    "single-mcp-final-reply",
  );
  for (const changes of [
    { activationIds: ["extra"] },
    { unresolvedMentionHandles: ["unknown"] },
    { replacedDraft: {} },
    { extra: "unknown" },
  ])
    assert.throws(
      () =>
        validateMcpInlineRound(
          options({
            events: [user(), call(), output({ ...receipt, ...changes })],
          }),
        ),
      /receipt/i,
    );
});

test("receipt cannot precede its current call", () => {
  assert.throws(
    () =>
      validateMcpInlineRound(options({ events: [user(), output(), call()] })),
    /order|precede/i,
  );
});

test("retain follow-up generation cost instead of rejecting a valid single delivery", () => {
  assert.equal(
    validateMcpInlineRound(
      options({ round: { ...round, metrics: { generations: 2 } } }),
    ).replyProof,
    "single-mcp-final-reply",
  );
});

test("compact receipt correlates to the durable reply without model-visible identity fields", () => {
  const compact = { state: "published", messageId: "message-1", roomSeq: 12 };
  const o = options({ events: [user(), call(), output(compact)] });
  const before = structuredClone(o);
  assert.equal(validateMcpInlineRound(o).replyProof, "single-mcp-final-reply");
  assert.deepEqual(o, before);
  const direct = options({
    events: [
      user(),
      row({
        type: "function_call",
        name: "mcp__loom_worker__loom_reply",
        call_id: "direct",
        arguments: JSON.stringify({
          body: "exact",
          final: true,
          basedOnRoomSeq: 8,
        }),
      }),
      row({
        type: "function_call_output",
        call_id: "direct",
        output: JSON.stringify({
          isError: false,
          content: [{ type: "text", text: JSON.stringify(compact) }],
        }),
      }),
    ],
  });
  assert.equal(
    validateMcpInlineRound(direct).replyProof,
    "single-mcp-final-reply",
  );
});

test("compact normal-round receipt cannot hide mismatches, warnings or delivery effects", () => {
  const compact = { state: "published", messageId: "message-1", roomSeq: 12 };
  for (const changes of [
    { messageId: "other" },
    { roomSeq: 11 },
    { state: "held" },
    { deduplicated: true },
    { replacedDraft: { draftId: "draft-1" } },
    { unresolvedMentionHandles: ["missing"] },
    { activationIds: ["extra"] },
    { actorId: "actor-1" },
    { eventId: "event-1" },
    { extra: "unknown" },
  ]) {
    assert.throws(
      () =>
        validateMcpInlineRound(
          options({
            events: [user(), call(), output({ ...compact, ...changes })],
          }),
        ),
      /receipt/i,
    );
  }
});

test("compact receipt never substitutes for a complete current durable marker and actor", () => {
  const compact = { state: "published", messageId: "message-1", roomSeq: 12 };
  for (const mutate of [
    (r) => {
      delete r.finalMarker.event_id;
    },
    (r) => {
      r.finalMarker.run_attempt_id = "old-run";
    },
    (r) => {
      r.finalMarker.room_seq = 11;
    },
    (r) => {
      r.finalMarker.room_id = "other-room";
    },
    (r) => {
      r.replies[0].actorId = "other-actor";
    },
    (r) => {
      r.replies[0].threadId = "other-target";
    },
    (r) => {
      r.replies[0].roomSeq = 8;
      r.finalMarker.room_seq = 8;
    },
    (r) => {
      delete r.replies[0].roomId;
      delete r.finalMarker.room_id;
    },
  ]) {
    const o = options({ events: [user(), call(), output(compact)] });
    mutate(o.round);
    assert.throws(() => validateMcpInlineRound(o), /marker|reply/i);
  }
});

test("native namespaced MCP result is joined to durable delivery, spoof and contradictory results reject", () => {
  const c = row({
    type: "function_call",
    namespace: "mcp__loom_worker",
    name: "loom_reply",
    call_id: "call-1",
    arguments: JSON.stringify({
      body: "exact",
      basedOnRoomSeq: 8,
      final: true,
      threadId: null,
    }),
  });
  const o = row({
    type: "function_call_output",
    call_id: "call-1",
    output: [
      { type: "input_text", text: "Wall time: 0.01 seconds\nOutput:" },
      {
        type: "input_text",
        text: JSON.stringify({
          state: "published",
          messageId: "message-1",
          roomSeq: 12,
        }),
      },
    ],
  });
  assert.equal(
    validateMcpInlineRound(options({ events: [user(), c, o] })).replyProof,
    "single-mcp-final-reply",
  );
  for (const namespace of [undefined, "evil", "mcp__loom_worker_fake"]) {
    const bad = structuredClone(c);
    bad.payload.namespace = namespace;
    assert.throws(() =>
      validateMcpInlineRound(options({ events: [user(), bad, o] })),
    );
  }
  for (const extra of [
    { state: "published", messageId: "wrong", roomSeq: 12 },
    { error: { code: "RESULT_UNKNOWN" } },
  ]) {
    const bad = structuredClone(o);
    bad.payload.output.push({
      type: "input_text",
      text: JSON.stringify(extra),
    });
    assert.throws(() =>
      validateMcpInlineRound(options({ events: [user(), c, bad] })),
    );
  }
});

test("code-mode evidence with a foreign namespace is not a Worker call", () => {
  const c = call();
  c.payload.namespace = "foreign";
  assert.throws(
    () => validateMcpInlineRound(options({ events: [user(), c, output()] })),
    /namespace/,
  );
});
