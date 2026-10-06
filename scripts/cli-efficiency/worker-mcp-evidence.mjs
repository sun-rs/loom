import assert from "node:assert/strict";
export const WORKER_MCP_REPLY = "mcp__loom_worker__loom_reply";
export function isWorkerMcpReply(name, namespace) {
  return namespace === undefined
    ? name === WORKER_MCP_REPLY
    : namespace === "mcp__loom_worker" && name === "loom_reply";
}
export function isDirectWorkerMcp(call) {
  return (
    call?.type === "function_call" &&
    call.namespace === "mcp__loom_worker" &&
    call.name === "loom_reply"
  );
}
// Observed native transport envelope only; never parse arbitrary prose as success.
export function directWorkerMcpResult(output) {
  assert.ok(
    Array.isArray(output) && output.length === 2,
    "ambiguous direct MCP output",
  );
  assert.ok(
    output.every((p) => p?.type === "input_text" && typeof p.text === "string"),
    "invalid direct MCP content",
  );
  assert.match(
    output[0].text,
    /^Wall time: \d+(?:\.\d+)? seconds\nOutput:$/u,
    "unknown direct MCP envelope",
  );
  const value = JSON.parse(output[1].text);
  assert.ok(
    value && typeof value === "object" && !Array.isArray(value),
    "invalid direct MCP result",
  );
  if (value.error?.code === "RESULT_UNKNOWN")
    throw new Error(
      "Execution evidence unknown: unknown write outcome requires verification",
    );
  assert.ok(
    value.state === "published" ||
      value.state === "held" ||
      value.state === "target_confirmation_required" ||
      typeof value.error?.code === "string",
    "unrecognized direct MCP result",
  );
  if (value.state === "published") {
    assert.equal(value.error, undefined, "contradictory direct MCP result");
    assert.equal(typeof value.messageId, "string");
    assert.ok(
      value.messageId.length > 0 &&
        Number.isSafeInteger(value.roomSeq) &&
        value.roomSeq > 0,
      "invalid published identity",
    );
  }
  return value;
}
