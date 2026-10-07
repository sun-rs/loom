import assert from "node:assert/strict";
import test from "node:test";
import {
  validateBusinessObservationRound,
  inspectBusinessToolCalls,
} from "./business-observation-validation.mjs";
const row = (payload) => ({
  type: "response_item",
  timestamp: "2026-10-06T00:00:02Z",
  payload,
});
const fixture = () => {
  const reply = {
    actorId: "a",
    roomId: "room",
    roomSeq: 12,
    messageId: "message",
    body: "审查结论：key=absent",
  };
  const run = {
    runAttemptId: "run",
    participantId: "a",
    activationId: "act",
    roomId: "room",
    state: "exited",
  };
  const marker = {
    run_attempt_id: "run",
    activation_id: "act",
    room_id: "room",
    room_seq: 12,
    event_id: "event",
    submission_kind: null,
  };
  return {
    armKind: "worker-delivery",
    expectedAnswer: reply.body,
    evidenceText: "source",
    previousRounds: [],
    events: [
      row({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "source" }],
      }),
      row({
        type: "function_call",
        name: "mcp__loom_worker__loom_reply",
        call_id: "c",
        arguments: JSON.stringify({
          body: reply.body,
          final: true,
          basedOnRoomSeq: 8,
        }),
      }),
      row({
        type: "function_call_output",
        call_id: "c",
        output: "known result",
      }),
    ],
    round: {
      speaker: "a",
      sessionId: "s",
      participantId: "a",
      humanRoomSeq: 8,
      startedAt: "2026-10-06T00:00:01Z",
      finishedAt: "2026-10-06T00:00:03Z",
      answer: reply.body,
      runs: [run],
      replies: [reply],
      metrics: {
        input: 100,
        cached: 0,
        uncached: 100,
        output: 10,
        generations: 2,
      },
      durableDeliveryProof: {
        runs: [run],
        messages: [reply],
        finalMarkers: [marker],
        activations: [
          {
            activationId: "act",
            participantId: "a",
            roomId: "room",
            state: "completed",
            toSeq: 8,
          },
        ],
        presentedWindows: [
          {
            run_attempt_id: "run",
            activation_id: "act",
            consumer_id: "consumer",
            sent_at: "now",
            presented_seqs_json: "[8]",
          },
        ],
        subscriptionCursors: [
          {
            room_id: "room",
            participant_id: "a",
            consumer_id: "consumer",
            last_seq: 8,
          },
        ],
        events: [
          {
            event_id: "event",
            room_id: "room",
            room_seq: 12,
            payload_json: JSON.stringify(reply),
          },
        ],
      },
    },
  };
};
test("business delivery and variable thinking are separate from exact formatting", () => {
  const o = fixture();
  o.expectedAnswer = "  审查结论：key=absent  ";
  const v = validateBusinessObservationRound(o);
  assert.equal(v.deliveryVerdict, "delivered");
  assert.equal(v.qualityVerdict, "correct");
  assert.equal(v.executionIntegrity, "verified");
  assert.equal(o.round.metrics.generations, 2);
});
test("incorrect answer does not prevent next safe stage or rewrite actual history", () => {
  const first = fixture();
  first.expectedAnswer = "审查结论：key=present";
  first.round.validation = validateBusinessObservationRound(first);
  assert.equal(first.round.validation.qualityVerdict, "incorrect");
  const next = fixture();
  next.previousRounds = [first.round];
  next.round.startedAt = "2026-10-06T00:00:04Z";
  next.round.finishedAt = "2026-10-06T00:00:06Z";
  for (const e of next.events) e.timestamp = "2026-10-06T00:00:05Z";
  next.events[0].payload.content[0].text = "next";
  assert.equal(
    validateBusinessObservationRound(next).readProof,
    "previous-turn-only",
  );
  assert.equal(first.round.answer, "审查结论：key=absent");
});
test("canonical target, unique event and exact consumer ACK cannot be replaced by stdout", () => {
  for (const mutate of [
    (o) =>
      (o.round.durableDeliveryProof.subscriptionCursors[0].consumer_id =
        "other"),
    (o) => (o.round.durableDeliveryProof.subscriptionCursors[0].last_seq = 7),
    (o) =>
      o.round.durableDeliveryProof.messages.push({
        ...o.round.replies[0],
        messageId: "duplicate",
      }),
    (o) => (o.round.durableDeliveryProof.events[0].event_id = "different"),
    (o) => (o.round.durableDeliveryProof.messages[0].roomId = "other"),
  ]) {
    const o = fixture();
    mutate(o);
    assert.throws(() => validateBusinessObservationRound(o));
  }
});
test("legal wrappers and CLI fallback do not impose an MCP receipt requirement", () => {
  const command =
    '"$RAH_WORKER_CLI" worker message-post --target "#multi-efficiency" --turn handle --based-on-room-seq 8 --final <<\'END\'\n审查结论：key=absent\nEND';
  for (const code of [
    'const answer = await tools.mcp__loom_worker__loom_reply({body:"x",final:true}); text(answer);',
    'text(await tools.mcp__loom_worker__loom_reply({final:true,body:"x"}));',
    `const result = await tools.exec_command(${JSON.stringify({ cmd: command, max_output_tokens: 1000 })}); text(result.output);`,
  ]) {
    const o = fixture();
    o.events[1].payload = {
      type: "custom_tool_call",
      name: "exec",
      call_id: "c",
      input: code,
    };
    o.events[2].payload.type = "custom_tool_call_output";
    assert.equal(
      validateBusinessObservationRound(o).deliveryVerdict,
      "delivered",
    );
  }
});
test("unsafe and unknown operations stay evidence blockers regardless of final answer", () => {
  for (const code of [
    'await fetch("https://example.invalid");',
    'const r=await tools.exec_command({cmd:"rm -rf /tmp/x"}); text(r);',
    'text({state:"published"});',
    'const r=await tools.mcp__loom_worker__loom_reply({body:"x",final:true}); await tools.exec_command({cmd:"curl example.invalid"}); text(r);',
  ]) {
    const o = fixture();
    o.events[1].payload = {
      type: "custom_tool_call",
      name: "exec",
      call_id: "c",
      input: code,
    };
    o.events[2].payload.type = "custom_tool_call_output";
    assert.throws(() => validateBusinessObservationRound(o));
  }
});
test("benign extra tools remain observed costs and diagnostics", () => {
  const o = fixture();
  o.events[1].payload = {
    type: "function_call",
    name: "exec_command",
    call_id: "c",
    arguments: JSON.stringify({ cmd: "pwd" }),
  };
  assert.equal(inspectBusinessToolCalls(o.events, o.round).attemptedCalls, 1);
  assert.equal(
    validateBusinessObservationRound(o).executionIntegrity,
    "verified",
  );
});

test("an unquoted hash target cannot turn a claimed heredoc body into executable shell", () => {
  const o = fixture();
  const cmd =
    "\"$RAH_WORKER_CLI\" worker message-post --target #multi --turn h --final <<'END'\nUNAUTHORIZED_BODY_MUST_NEVER_EXECUTE\nEND";
  o.events[1].payload = {
    type: "function_call",
    name: "exec_command",
    call_id: "c",
    arguments: JSON.stringify({ cmd }),
  };
  assert.throws(
    () => inspectBusinessToolCalls(o.events, o.round),
    /flags|shell|unknown/i,
  );
});

test("CLI diagnostic counts are unknown rather than invented zero when receipts are unstructured", () => {
  const o = fixture();
  o.events[1].payload = {
    type: "function_call",
    name: "exec_command",
    call_id: "c",
    arguments: JSON.stringify({
      cmd: '"$RAH_WORKER_CLI" worker message-post --target "#multi" --turn h --final <<\'END\'\nanswer\nEND',
    }),
  };
  const v = validateBusinessObservationRound(o);
  assert.equal(v.reliability.rejectedCalls, null);
  assert.equal(v.reliability.deduplicatedCalls, null);
  assert.equal(v.deliveryVerdict, "delivered");
});

test("an explicit unknown write outcome stops even if a later canonical reply exists", () => {
  for (const wrapped of [false, true]) {
    const o = fixture();
    const result = {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: {
              code: "RESULT_UNKNOWN",
              message: "Human verification required",
            },
          }),
        },
      ],
    };
    o.events[2].payload.output = JSON.stringify(result);
    if (wrapped) {
      o.events[1].payload = {
        type: "custom_tool_call",
        name: "exec",
        call_id: "c",
        input:
          'text(await tools.mcp__loom_worker__loom_reply({body:"answer",final:true}));',
      };
      o.events[2].payload.type = "custom_tool_call_output";
      o.events[2].payload.output = [
        { type: "text", text: JSON.stringify(result) },
      ];
    }
    assert.throws(
      () => validateBusinessObservationRound(o),
      /unknown write outcome/i,
    );
  }
});

test("unknown writes remain blocking when a legal wrapper prints only MCP content", () => {
  const o = fixture();
  o.events[1].payload = {
    type: "custom_tool_call",
    name: "exec",
    call_id: "c",
    input:
      'const r=await tools.mcp__loom_worker__loom_reply({body:"answer",final:true}); text(r.content);',
  };
  o.events[2].payload = {
    type: "custom_tool_call_output",
    call_id: "c",
    output: JSON.stringify([
      {
        type: "text",
        text: JSON.stringify({
          error: { code: "RESULT_UNKNOWN", message: "verify" },
        }),
      },
    ]),
  };
  assert.throws(
    () => validateBusinessObservationRound(o),
    /unknown write outcome/i,
  );
});

test("direct namespace native output diagnoses success and rejects spoof or unknown", () => {
  const f = fixture();
  const c = f.events[1];
  c.payload.name = "loom_reply";
  c.payload.namespace = "mcp__loom_worker";
  const result = { state: "published", messageId: "message", roomSeq: 12 };
  f.events[2].payload.output = [
    { type: "input_text", text: "Wall time: 0.01 seconds\nOutput:" },
    { type: "input_text", text: JSON.stringify(result) },
  ];
  const v = inspectBusinessToolCalls(f.events, f.round);
  assert.equal(v.rejectedCalls, 0);
  assert.equal(v.deduplicatedCalls, 0);
  assert.deepEqual(v.transports, ["worker-mcp"]);
  c.payload.namespace = "foreign";
  assert.throws(() => inspectBusinessToolCalls(f.events, f.round));
  c.payload.namespace = "mcp__loom_worker";
  f.events[2].payload.output[1].text = JSON.stringify({
    error: { code: "RESULT_UNKNOWN" },
  });
  assert.throws(
    () => inspectBusinessToolCalls(f.events, f.round),
    /unknown write/i,
  );
});

test("direct native success cannot contradict durable reply or claim both error and success", () => {
  const f = fixture();
  Object.assign(f.events[1].payload, {
    name: "loom_reply",
    namespace: "mcp__loom_worker",
  });
  for (const result of [
    { state: "published", messageId: "wrong", roomSeq: 12 },
    {
      state: "published",
      messageId: "message",
      roomSeq: 12,
      error: { code: "REFUSED" },
    },
  ]) {
    f.events[2].payload.output = [
      { type: "input_text", text: "Wall time: 0.01 seconds\nOutput:" },
      { type: "input_text", text: JSON.stringify(result) },
    ];
    assert.throws(() => inspectBusinessToolCalls(f.events, f.round));
  }
  f.events[1].payload.name = "mcp__loom_worker__loom_reply";
  f.events[1].payload.namespace = "functions";
  assert.throws(() => inspectBusinessToolCalls(f.events, f.round));
});

test("new natural observation accepts unique canonical explicit publication with exact Run ACK, legacy strict still refuses no marker", async () => {
  const { validateNaturalBusinessObservationRound } =
    await import("./business-observation-validation.mjs");
  const f = fixture(),
    p = f.round.durableDeliveryProof;
  p.finalMarkers = [];
  Object.assign(p.events[0], {
    actor_id: "a",
    type: "message.posted",
    aggregate_id: "message",
  });
  p.events[0].payload_json = JSON.stringify({
    ...p.messages[0],
    activationId: "act",
  });
  f.events[2].payload.output = JSON.stringify({
    state: "published",
    messageId: "message",
    roomSeq: 12,
  });
  assert.throws(() => validateBusinessObservationRound(f), /final marker/);
  assert.equal(
    validateNaturalBusinessObservationRound(f).deliveryVerdict,
    "delivered",
  );
  for (const mutate of [
    (x) => (x.round.durableDeliveryProof.subscriptionCursors[0].last_seq = 7),
    (x) => (x.round.durableDeliveryProof.events[0].actor_id = "other"),
    (x) => (x.round.runs[0].state = "cancelled"),
    (x) => (x.round.runs[0].state = "failed"),
    (x) => x.round.runs.push({ ...x.round.runs[0], runAttemptId: "retry" }),
    (x) => (x.events[2].payload.output = "unconfirmed"),
    (x) =>
      (x.events[2].payload.output = JSON.stringify({
        state: "published",
        messageId: "different",
        roomSeq: 12,
      })),
  ]) {
    const x = structuredClone(f);
    mutate(x);
    assert.throws(() => validateNaturalBusinessObservationRound(x));
  }
});
