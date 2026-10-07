import {
  WORKER_MCP_REPLY,
  isWorkerMcpReply,
  isDirectWorkerMcp,
  directWorkerMcpResult,
} from "./worker-mcp-evidence.mjs";
import assert from "node:assert/strict";
import ts from "typescript";
const fail = (message) => {
  throw new Error(`Execution evidence unknown: ${message}`);
};
function literal(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isObjectLiteralExpression(node)) {
    const value = {};
    for (const p of node.properties) {
      if (
        !ts.isPropertyAssignment(p) ||
        !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
      )
        fail("dynamic tool arguments");
      assert.ok(!Object.hasOwn(value, p.name.text), "duplicate argument");
      value[p.name.text] = literal(p.initializer);
    }
    return value;
  }
  return fail("nonliteral tool argument");
}
function operation(name, args) {
  assert.ok(
    args && typeof args === "object" && !Array.isArray(args),
    "tool arguments required",
  );
  if (name === "mcp__loom_worker__loom_reply") {
    assert.ok(
      Object.keys(args).every((k) =>
        [
          "body",
          "final",
          "basedOnRoomSeq",
          "threadId",
          "reviseDraftId",
        ].includes(k),
      ),
      "unregistered MCP field",
    );
    assert.equal(typeof args.body, "string");
    return "worker-mcp";
  }
  if (name !== "exec_command") return fail("unregistered operation " + name);
  assert.ok(
    Object.keys(args).every((k) =>
      ["cmd", "max_output_tokens", "yield_time_ms"].includes(k),
    ),
    "unregistered process option",
  );
  assert.equal(typeof args.cmd, "string");
  if (["pwd", "true"].includes(args.cmd.trim())) return "benign-extra-tool";
  // A quoted heredoc is data, never executable shell. Only the existing Worker
  // binary and literal reply flags are admitted; no arbitrary shell evaluation.
  const m = args.cmd.match(
    /^"\$RAH_WORKER_CLI" worker message-post (.*?)<<'([A-Za-z_][A-Za-z_0-9]*)'\r?\n([\s\S]*)\r?\n\2\s*$/u,
  );
  if (!m || m[3].split(/\r?\n/u).includes(m[2]))
    return fail("unregistered shell operation");
  const flags = m[1].trim();
  const flag =
    /(?:--(?:target|thread-id|turn) (?:"[A-Za-z0-9_#./:-]+"|'[A-Za-z0-9_#./:-]+'|[A-Za-z0-9_./:-]+)|--based-on-room-seq \d+|--final|--top-level)/gu;
  const tokens = [...flags.matchAll(flag)];
  assert.ok(
    tokens.length && flags.replace(flag, "").trim() === "",
    "unregistered Worker flags",
  );
  assert.equal(
    tokens.map((x) => x[0].split(" ")[0]).length,
    new Set(tokens.map((x) => x[0].split(" ")[0])).size,
    "duplicate Worker flags",
  );
  return "worker-cli";
}
function wrapper(source) {
  const file = ts.createSourceFile(
    "observed.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  assert.equal(file.parseDiagnostics.length, 0, "unparseable tool wrapper");
  const bindings = new Set(),
    operations = [];
  function inspect(node) {
    if (ts.isAwaitExpression(node)) return inspect(node.expression);
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(file);
      if (name.startsWith("tools.") && node.arguments.length === 1) {
        operations.push(operation(name.slice(6), literal(node.arguments[0])));
        return;
      }
      if (
        ["text", "JSON.stringify"].includes(name) &&
        node.arguments.length === 1
      )
        return inspect(node.arguments[0]);
    }
    if (ts.isIdentifier(node) && bindings.has(node.text)) return;
    if (
      ts.isPropertyAccessExpression(node) &&
      ["output", "content", "isError"].includes(node.name.text) &&
      ts.isIdentifier(node.expression) &&
      bindings.has(node.expression.text)
    )
      return;
    fail("unverified wrapper operation");
  }
  for (const s of file.statements) {
    if (ts.isEmptyStatement(s)) continue;
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        assert.ok(
          ts.isIdentifier(d.name) && d.initializer,
          "unsupported binding",
        );
        inspect(d.initializer);
        assert.ok(
          !bindings.has(d.name.text) &&
            !["tools", "text", "JSON"].includes(d.name.text),
          "shadowed binding",
        );
        bindings.add(d.name.text);
      }
    } else if (ts.isExpressionStatement(s)) inspect(s.expression);
    else fail("unsupported executable statement");
  }
  assert.ok(operations.length, "no verified tool operation");
  return operations;
}
// Inspect only known MCP text/content projections, never execute provider code.
function unknownWrite(value, depth = 0) {
  if (depth > 8) fail("tool result nesting cannot be verified");
  if (typeof value === "string") {
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      return false;
    }
    return unknownWrite(parsed, depth + 1);
  }
  if (Array.isArray(value))
    return value.some((part) => unknownWrite(part, depth + 1));
  if (!value || typeof value !== "object") return false;
  return (
    value.error?.code === "RESULT_UNKNOWN" ||
    (Array.isArray(value.content) && unknownWrite(value.content, depth + 1)) ||
    (["text", "input_text"].includes(value.type) &&
      typeof value.text === "string" &&
      unknownWrite(value.text, depth + 1))
  );
}
// Known result surfaces only; never search arbitrary prose for a receipt.
export function publicationReceipts(value, depth = 0) {
  if (depth > 8) return [];
  if (typeof value === "string") {
    try {
      return publicationReceipts(JSON.parse(value), depth + 1);
    } catch {}
    const m = value
      .trim()
      .match(
        /^Message sent to [^\r\n]+\. Message ID: (message_[A-Za-z0-9_-]+)$/u,
      );
    return m ? [{ messageId: m[1] }] : [];
  }
  if (Array.isArray(value))
    return value.flatMap((v) => publicationReceipts(v, depth + 1));
  if (!value || typeof value !== "object") return [];
  if (
    value.state === "published" &&
    typeof value.messageId === "string" &&
    Number.isSafeInteger(value.roomSeq)
  )
    return [{ messageId: value.messageId, roomSeq: value.roomSeq }];
  if (Array.isArray(value.content))
    return publicationReceipts(value.content, depth + 1);
  if (["text", "input_text"].includes(value.type))
    return publicationReceipts(value.text, depth + 1);
  return [];
}
export function inspectBusinessToolCalls(
  events,
  round,
  { collectReceipts = false } = {},
) {
  const publishedReceipts = [];
  const start = Date.parse(round.startedAt),
    end = Date.parse(round.finishedAt),
    pending = new Map(),
    seen = new Set(),
    transports = [];
  let diagnosticsComplete = true;
  let attemptedCalls = 0,
    rejectedCalls = 0,
    deduplicatedCalls = 0;
  for (const e of events) {
    if (e.type !== "response_item") continue;
    const time = Date.parse(e.timestamp);
    assert.ok(Number.isFinite(time), "missing response timestamp");
    if (time < start || time > end) continue;
    const p = e.payload;
    if (["message", "reasoning"].includes(p?.type)) continue;
    if (["function_call", "custom_tool_call"].includes(p?.type)) {
      assert.ok(p.call_id && !seen.has(p.call_id), "duplicate call id");
      seen.add(p.call_id);
      pending.set(p.call_id, {
        type: p.type,
        time,
        direct: isDirectWorkerMcp(p),
      });
      assert.ok(
        p.namespace === undefined ||
          p.namespace === "functions" ||
          isDirectWorkerMcp(p),
        "unregistered tool namespace",
      );
      assert.ok(
        p.name !== WORKER_MCP_REPLY || p.namespace === undefined,
        "inconsistent MCP namespace",
      );
      const ops =
        p.type === "custom_tool_call" && p.name === "exec"
          ? wrapper(p.input)
          : [
              operation(
                isWorkerMcpReply(p.name, p.namespace)
                  ? WORKER_MCP_REPLY
                  : p.name,
                JSON.parse(p.arguments),
              ),
            ];
      if (p.type !== "function_call" || !isWorkerMcpReply(p.name, p.namespace))
        diagnosticsComplete = false;
      attemptedCalls += ops.length;
      transports.push(...ops);
    } else if (
      ["function_call_output", "custom_tool_call_output"].includes(p?.type)
    ) {
      const call = pending.get(p.call_id);
      assert.ok(call && call.time <= time, "uncorrelated tool result");
      assert.equal(
        p.type,
        call.type === "function_call"
          ? "function_call_output"
          : "custom_tool_call_output",
      );
      pending.delete(p.call_id);
      if (collectReceipts)
        publishedReceipts.push(...publicationReceipts(p.output));
      if (call.direct) {
        const v = directWorkerMcpResult(p.output);
        if (v.state === "published") {
          assert.ok(
            round.replies?.some(
              (r) => r.messageId === v.messageId && r.roomSeq === v.roomSeq,
            ),
            "direct MCP receipt differs from durable reply",
          );
        } else rejectedCalls++;
        if (v.deduplicated === true) deduplicatedCalls++;
        continue;
      }
      const texts =
        typeof p.output === "string"
          ? [p.output]
          : (p.output ?? []).map((x) => x.text ?? "");
      let resultRecognized = false;
      const unknownWriteOutcome = texts.some((text) => unknownWrite(text));
      for (const text of texts) {
        try {
          const v = JSON.parse(text);
          if (typeof v?.isError === "boolean" && Array.isArray(v.content))
            resultRecognized = true;
          if (v.isError === true) rejectedCalls++;
          for (const part of v.content ?? []) {
            try {
              const result = JSON.parse(part.text);
              if (result.deduplicated === true) deduplicatedCalls++;
            } catch {}
          }
        } catch {}
      }
      if (unknownWriteOutcome)
        fail("unknown write outcome requires verification");
      if (!resultRecognized) diagnosticsComplete = false;
    } else fail("unsupported tool event");
  }
  assert.equal(pending.size, 0, "tool result missing");
  return {
    ...(collectReceipts ? { publishedReceipts } : {}),
    attemptedCalls,
    rejectedCalls: diagnosticsComplete ? rejectedCalls : null,
    deduplicatedCalls: diagnosticsComplete ? deduplicatedCalls : null,
    transports,
  };
}
const normalize = (text) =>
  String(text ?? "")
    .trim()
    .replace(/^```(?:text)?\s*\n([\s\S]*?)\n```$/u, "$1")
    .trim();
export function validateBusinessObservationRound(
  { armKind, round, previousRounds, events, expectedAnswer, evidenceText },
  { allowNatural = false } = {},
) {
  assert.ok(["native", "worker-delivery"].includes(armKind));
  const start = Date.parse(round.startedAt),
    end = Date.parse(round.finishedAt);
  assert.ok(
    Number.isFinite(start) && Number.isFinite(end) && start <= end,
    "invalid stage window",
  );
  assert.ok(evidenceText, "missing material");
  for (const [i, r] of previousRounds.entries())
    assert.ok(
      r !== round &&
        r.sessionId === round.sessionId &&
        r.speaker === round.speaker &&
        Date.parse(r.finishedAt) < start &&
        !r.validationError &&
        r.validation?.executionIntegrity === "verified" &&
        r.validation?.readProof ===
          (i === 0 ? "complete-inline-input" : "previous-turn-only"),
      "invalid continuation evidence",
    );
  const texts = events
    .filter(
      (e) =>
        e.type === "response_item" &&
        e.payload?.role === "user" &&
        Date.parse(e.timestamp) >= start &&
        Date.parse(e.timestamp) <= end,
    )
    .flatMap((e) =>
      (e.payload.content ?? [])
        .filter((c) => c.type === "input_text")
        .map((c) => c.text),
    );
  assert.ok(texts.length, "no current input");
  assert.equal(
    texts.reduce((n, t) => n + t.split(evidenceText).length - 1, 0),
    previousRounds.length ? 0 : 1,
    "material retransmission or omission",
  );
  const tools = inspectBusinessToolCalls(events, round, {
    collectReceipts: allowNatural,
  });
  if (armKind === "worker-delivery") {
    const p = round.durableDeliveryProof;
    assert.ok(p, "missing durable proof");
    assert.equal(p.messages.length, 1, "nonunique business reply");
    const message = p.messages[0];
    assert.equal(message.actorId, round.participantId);
    assert.ok(!message.threadId, "wrong reply target");
    assert.equal(message.body, round.answer);
    assert.deepEqual(round.replies, [message]);
    if (allowNatural)
      assert.ok(p.finalMarkers.length <= 1, "nonunique final marker");
    else assert.equal(p.finalMarkers.length, 1, "nonunique final marker");
    const marker = p.finalMarkers[0];
    if (marker) {
      assert.equal(marker.room_id, message.roomId);
      assert.equal(marker.room_seq, message.roomSeq);
      assert.equal(marker.submission_kind, null);
    }
    const event = p.events.find((e) =>
      marker
        ? e.event_id === marker.event_id
        : e.aggregate_id === message.messageId &&
          e.room_seq === message.roomSeq &&
          e.room_id === message.roomId,
    );
    assert.ok(
      event &&
        event.room_id === message.roomId &&
        event.room_seq === message.roomSeq,
      "missing canonical event",
    );
    const payload = JSON.parse(event.payload_json);
    assert.equal(payload.body, message.body);
    assert.equal(payload.messageId, message.messageId);
    assert.deepEqual(p.runs, round.runs);
    assert.ok(p.runs.length);
    const run = marker
      ? p.runs.find((r) => r.runAttemptId === marker.run_attempt_id)
      : p.runs.length === 1
        ? p.runs[0]
        : undefined;
    if (allowNatural) {
      assert.ok(
        run &&
          run.state === "exited" &&
          (run.exitCode === undefined || run.exitCode === 0),
        "Unsuccessful or nonunique natural Run",
      );
      assert.equal(event.actor_id, message.actorId);
      assert.equal(event.type, "message.posted");
      assert.equal(event.aggregate_id, message.messageId);
      if (!marker) {
        assert.equal(
          payload.activationId,
          run.activationId,
          "Publication belongs to another Activation",
        );
        assert.ok(
          tools.publishedReceipts.some(
            (r) =>
              r.messageId === message.messageId &&
              (r.roomSeq === undefined || r.roomSeq === message.roomSeq),
          ),
          "No correlated Worker publication receipt",
        );
      }
    }
    assert.ok(
      run &&
        run.participantId === round.participantId &&
        run.roomId === message.roomId,
    );
    for (const r of p.runs)
      assert.ok(
        r.activationId === run.activationId &&
          r.participantId === run.participantId &&
          r.roomId === run.roomId,
        "unattributed Run",
      );
    const act = p.activations.find((a) => a.activationId === run.activationId);
    assert.ok(act && act.state === "completed", "Activation not completed");
    const window = p.presentedWindows.find(
      (w) =>
        w.run_attempt_id === run.runAttemptId &&
        w.activation_id === act.activationId &&
        w.sent_at,
    );
    assert.ok(window, "missing actual presentation");
    const cursor = p.subscriptionCursors.find(
      (c) =>
        c.consumer_id === window.consumer_id &&
        c.room_id === message.roomId &&
        c.participant_id === round.participantId,
    );
    assert.ok(
      cursor && cursor.last_seq >= act.toSeq,
      "missing exact consumer ACK",
    );
    assert.ok(
      JSON.parse(window.presented_seqs_json).includes(round.humanRoomSeq),
      "current message not presented",
    );
  }
  const answer = normalize(round.answer),
    expected = normalize(expectedAnswer);
  const qualityVerdict =
    answer === expected
      ? "correct"
      : /^审查结论：[^=\n]+=\S+$/u.test(answer)
        ? "incorrect"
        : "unscorable";
  return {
    executionIntegrity: "verified",
    deliveryVerdict: "delivered",
    qualityVerdict,
    readProof: previousRounds.length
      ? "previous-turn-only"
      : "complete-inline-input",
    transportDiagnostics: tools.transports,
    reliability: {
      attemptedCalls: tools.attemptedCalls,
      rejectedCalls: tools.rejectedCalls,
      deduplicatedCalls: tools.deduplicatedCalls,
    },
  };
}

// Separate observation profile; the original strict-final gate is unchanged.
export function validateNaturalBusinessObservationRound(args) {
  return validateBusinessObservationRound(args, { allowNatural: true });
}
