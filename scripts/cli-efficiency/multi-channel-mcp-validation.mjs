import assert from "node:assert/strict";
import ts from "typescript";
import { validateInlineChannelRound } from "./multi-channel-inline-validation.mjs";

// Offline inspection only. Provider-authored JavaScript is never executed here.
function literalArguments(node) {
  assert.ok(
    ts.isObjectLiteralExpression(node),
    "tool arguments must be literal",
  );
  const values = {};
  for (const p of node.properties) {
    assert.ok(
      ts.isPropertyAssignment(p) &&
        (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)),
      "tool arguments must be literal properties",
    );
    const key = p.name.text;
    assert.ok(!Object.hasOwn(values, key), "duplicate tool argument");
    const v = p.initializer;
    if (ts.isStringLiteral(v)) values[key] = v.text;
    else if (ts.isNumericLiteral(v)) values[key] = Number(v.text);
    else if (v.kind === ts.SyntaxKind.TrueKeyword) values[key] = true;
    else if (v.kind === ts.SyntaxKind.FalseKeyword) values[key] = false;
    else if (v.kind === ts.SyntaxKind.NullKeyword) values[key] = null;
    else assert.fail("tool arguments must have literal values");
  }
  return values;
}
function awaitedReply(node) {
  assert.ok(node && ts.isAwaitExpression(node), "tool reply must be awaited");
  const c = node.expression;
  assert.ok(
    ts.isCallExpression(c) &&
      c.expression.getText() === "tools.mcp__loom_worker__loom_reply" &&
      c.arguments.length === 1,
    "unregistered tool reply",
  );
  return literalArguments(c.arguments[0]);
}
export function replyArguments(call) {
  if (
    call.type === "function_call" &&
    call.name === "mcp__loom_worker__loom_reply"
  )
    return JSON.parse(call.arguments);
  assert.ok(
    call.type === "custom_tool_call" &&
      call.name === "exec" &&
      typeof call.input === "string",
    "unregistered tool call",
  );
  const file = ts.createSourceFile(
    "reply.js",
    call.input,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  assert.equal(file.parseDiagnostics.length, 0, "invalid tool source");
  const statements = [...file.statements];
  assert.ok(
    statements.length === 1 || statements.length === 2,
    "unregistered tool statements",
  );
  let variable, args;
  if (statements.length === 2) {
    const s = statements.shift();
    assert.ok(
      ts.isVariableStatement(s) && s.declarationList.declarations.length === 1,
      "unregistered tool binding",
    );
    const d = s.declarationList.declarations[0];
    assert.ok(ts.isIdentifier(d.name), "unregistered tool binding");
    variable = d.name.text;
    args = awaitedReply(d.initializer);
  }
  const final = statements[0];
  assert.ok(
    ts.isExpressionStatement(final) && ts.isCallExpression(final.expression),
    "tool must emit real result",
  );
  const emit = final.expression;
  assert.ok(
    ts.isIdentifier(emit.expression) &&
      emit.expression.text === "text" &&
      emit.arguments.length === 1,
    "tool must emit result once",
  );
  if (variable)
    assert.equal(
      emit.arguments[0].getText(),
      variable,
      "tool must emit actual result",
    );
  else args = awaitedReply(emit.arguments[0]);
  return args;
}
function publishedReceipt(output) {
  const texts =
    typeof output === "string"
      ? [output]
      : Array.isArray(output)
        ? output
            .filter(
              (x) => x.type === "input_text" && typeof x.text === "string",
            )
            .map((x) => x.text)
        : [];
  const candidates = [];
  for (const text of texts) {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      continue;
    }
    if (value?.isError === false && Array.isArray(value.content)) {
      for (const part of value.content) {
        if (part.type !== "text") continue;
        try {
          candidates.push(JSON.parse(part.text));
        } catch {
          /* non-receipt diagnostic */
        }
      }
    }
  }
  assert.equal(candidates.length, 1, "missing unique MCP receipt result");
  return candidates[0];
}
export function validateMcpInlineRound(options) {
  const { armKind, round, events, expectedAnswer } = options;
  assert.ok(["native", "worker-mcp"].includes(armKind), "unregistered arm");
  assert.ok(
    Number.isSafeInteger(round.metrics?.generations) &&
      round.metrics.generations > 0,
    "positive reported generation evidence required",
  );
  if (armKind === "native") return validateInlineChannelRound(options);
  const start = Date.parse(round.startedAt),
    end = Date.parse(round.finishedAt);
  assert.ok(
    Number.isFinite(start) && Number.isFinite(end) && start <= end,
    "invalid time bounds",
  );
  const calls = [],
    outputs = [];
  const retained = events.filter((e) => {
    if (e.type !== "response_item") return true;
    const time = Date.parse(e.timestamp);
    assert.ok(Number.isFinite(time), "missing response item time");
    if (time < start || time > end) return true;
    const type = e.payload?.type;
    if (["message", "reasoning"].includes(type)) return true;
    if (["function_call", "custom_tool_call"].includes(type))
      calls.push(e.payload);
    else if (["function_call_output", "custom_tool_call_output"].includes(type))
      outputs.push(e.payload);
    else assert.fail("unsupported tool item");
    return false;
  });
  assert.equal(calls.length, 1, "expected one MCP tool call");
  assert.equal(outputs.length, 1, "expected one MCP tool result");
  const call = calls[0],
    output = outputs[0];
  assert.ok(
    typeof call.call_id === "string" &&
      call.call_id &&
      output.call_id === call.call_id,
    "uncorrelated tool result",
  );
  assert.equal(
    output.type,
    call.type === "custom_tool_call"
      ? "custom_tool_call_output"
      : "function_call_output",
    "uncorrelated tool result type",
  );
  assert.ok(
    events.findIndex((e) => e.payload === output) >
      events.findIndex((e) => e.payload === call),
    "tool receipt cannot precede call order",
  );
  const args = replyArguments(call);
  assert.ok(
    args && typeof args === "object" && !Array.isArray(args),
    "invalid reply arguments",
  );
  assert.ok(
    Object.keys(args).every((k) =>
      ["body", "basedOnRoomSeq", "final", "threadId"].includes(k),
    ),
    "unregistered reply argument",
  );
  assert.equal(args.body, expectedAnswer, "reply argument body mismatch");
  assert.equal(
    args.basedOnRoomSeq,
    round.humanRoomSeq,
    "reply argument seq mismatch",
  );
  assert.equal(args.final, true, "reply argument final required");
  assert.ok(
    args.threadId === undefined || args.threadId === null,
    "reply target mismatch",
  );
  assert.equal(round.replies?.length, 1, "missing unique durable reply");
  assert.equal(round.runs?.length, 1, "missing unique durable Run");
  const reply = round.replies[0],
    marker = round.finalMarker;
  assert.ok(
    marker &&
      marker.submission_kind === null &&
      marker.run_attempt_id === round.runs[0].runAttemptId &&
      marker.room_id === reply.roomId &&
      marker.room_seq === reply.roomSeq,
    "incorrect final marker",
  );
  assert.ok(
    reply.body === expectedAnswer &&
      reply.actorId === round.participantId &&
      !reply.threadId,
    "durable reply mismatch",
  );
  const receipt = publishedReceipt(output.output);
  const { activationIds, unresolvedMentionHandles, ...published } = receipt;
  for (const list of [activationIds, unresolvedMentionHandles]) {
    assert.ok(
      list === undefined || (Array.isArray(list) && list.length === 0),
      "MCP receipt has unexpected delivery effects",
    );
  }
  assert.deepEqual(
    published,
    {
      state: "published",
      eventId: marker.event_id,
      roomId: reply.roomId,
      roomSeq: reply.roomSeq,
      actorId: reply.actorId,
      messageId: reply.messageId,
      threadId: null,
      deduplicated: false,
    },
    "MCP receipt differs from current durable reply",
  );
  const proof = validateInlineChannelRound({ ...options, events: retained });
  return { ...proof, replyProof: "single-mcp-final-reply" };
}
