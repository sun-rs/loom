import assert from "node:assert/strict";
import ts from "typescript";

// Offline evidence validation only. Never execute provider-authored code.
function readArguments(value) {
  assert.ok(
    value && typeof value === "object",
    "Missing read command arguments",
  );
  assert.equal(value.cmd, "cat evidence.txt", "Unregistered read command");
  assert.ok(
    Object.keys(value).every((k) =>
      ["cmd", "max_output_tokens", "yield_time_ms"].includes(k),
    ),
    "Unregistered read tool option",
  );
}
function readExpression(node) {
  assert.ok(ts.isAwaitExpression(node), "Read tool must be awaited");
  const call = node.expression;
  assert.ok(
    ts.isCallExpression(call) &&
      call.expression.getText() === "tools.exec_command" &&
      call.arguments.length === 1,
    "Unregistered read tool",
  );
  const arg = call.arguments[0];
  assert.ok(ts.isObjectLiteralExpression(arg), "Read command must be literal");
  const values = {};
  for (const prop of arg.properties) {
    assert.ok(
      ts.isPropertyAssignment(prop) &&
        (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)),
      "Read command options must be literal",
    );
    const key = prop.name.text;
    assert.ok(!Object.hasOwn(values, key), "Duplicate read tool option");
    assert.ok(
      ts.isStringLiteral(prop.initializer) ||
        ts.isNumericLiteral(prop.initializer),
      "Read command values must be literal",
    );
    values[key] = ts.isStringLiteral(prop.initializer)
      ? prop.initializer.text
      : Number(prop.initializer.text);
  }
  readArguments(values);
}
function checkReadCall(payload) {
  const name = payload.name;
  if (name === "exec_command" && payload.type === "function_call") {
    readArguments(JSON.parse(payload.arguments));
    return;
  }
  assert.ok(
    name === "exec" && payload.type === "custom_tool_call",
    "Unknown read tool form",
  );
  const file = ts.createSourceFile(
    "read.js",
    payload.input,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  assert.equal(file.parseDiagnostics.length, 0, "Invalid read tool source");
  const statements = [...file.statements];
  assert.ok(
    statements.length === 1 || statements.length === 2,
    "Read tool must execute one command",
  );
  let variable;
  if (statements.length === 2) {
    const first = statements.shift();
    assert.ok(
      ts.isVariableStatement(first) &&
        first.declarationList.declarations.length === 1,
      "Read tool requires one binding",
    );
    const declaration = first.declarationList.declarations[0];
    assert.ok(ts.isIdentifier(declaration.name), "Invalid read tool binding");
    variable = declaration.name.text;
    readExpression(declaration.initializer);
  }
  const final = statements[0];
  assert.ok(
    ts.isExpressionStatement(final) && ts.isCallExpression(final.expression),
    "Read tool must emit result",
  );
  const emit = final.expression;
  assert.ok(
    ts.isIdentifier(emit.expression) &&
      emit.expression.text === "text" &&
      emit.arguments.length === 1,
    "Read tool must emit once",
  );
  if (variable)
    assert.equal(
      emit.arguments[0].getText(),
      variable + ".output",
      "Read tool must emit actual output",
    );
  else readExpression(emit.arguments[0]);
}
function outputText(output) {
  if (typeof output === "string") return output;
  if (Array.isArray(output))
    return output
      .map((x) =>
        x?.type === "input_text" && typeof x.text === "string" ? x.text : "",
      )
      .join("");
  return "";
}
export function validateLongChannelRound({
  round,
  previousRounds,
  events,
  expectedAnswer,
  evidenceText,
}) {
  assert.ok(
    previousRounds.every((r) => r.speaker === round.speaker && r !== round),
    "Previous rounds must belong to same participant",
  );
  assert.ok(
    typeof expectedAnswer === "string" && expectedAnswer.length > 0,
    "Missing expected answer",
  );
  assert.equal(
    round.answer,
    expectedAnswer,
    "Noncanonical or incorrect answer",
  );
  assert.ok(
    typeof evidenceText === "string" && evidenceText.length > 0,
    "Missing evidence",
  );
  assert.ok(
    round.startedAt && round.finishedAt && round.startedAt <= round.finishedAt,
    "Invalid read evidence window",
  );
  const current = events.filter(
    (x) => x.timestamp >= round.startedAt && x.timestamp <= round.finishedAt,
  );
  const supportedItems = new Set([
    "message",
    "reasoning",
    "function_call",
    "custom_tool_call",
    "function_call_output",
    "custom_tool_call_output",
  ]);
  assert.ok(
    current.every(
      (x) => x.type !== "response_item" || supportedItems.has(x.payload?.type),
    ),
    "Unsupported response tool/item evidence",
  );
  const calls = current.filter(
    (x) =>
      x.type === "response_item" &&
      ["function_call", "custom_tool_call"].includes(x.payload?.type),
  );
  const outputs = current.filter(
    (x) =>
      x.type === "response_item" &&
      ["function_call_output", "custom_tool_call_output"].includes(
        x.payload?.type,
      ),
  );
  if (previousRounds.length) {
    assert.equal(calls.length, 0, "Later turn used a tool");
    assert.equal(outputs.length, 0, "Later turn contains tool results");
    return { answer: "exact", readProof: "previous-turn-only" };
  }
  assert.equal(calls.length, 1, "First turn requires exactly one read tool");
  checkReadCall(calls[0].payload);
  assert.ok(calls[0].payload.call_id, "Missing read correlation id");
  assert.equal(
    outputs.length,
    1,
    "First turn requires exactly one correlated result",
  );
  assert.equal(
    outputs[0].payload.call_id,
    calls[0].payload.call_id,
    "Uncorrelated read result",
  );
  assert.ok(
    current.indexOf(outputs[0]) > current.indexOf(calls[0]),
    "Read result precedes call",
  );
  const body = outputText(outputs[0].payload.output);
  assert.equal(
    body.split(evidenceText).length - 1,
    1,
    "Complete evidence must appear exactly once in tool result",
  );
  return { answer: "exact", readProof: "complete-tool-result" };
}
