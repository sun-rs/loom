// Opt-in laboratory adapter only. No runtime, daemon or product imports this.
// Provider-specific extraction MUST establish original terminal identity first.
import assert from "node:assert/strict";
import { z } from "zod";
import { WorkerMcpExecution } from "../../packages/agent-host/src/worker-mcp-execution.ts";

const schema = z
  .object({
    kind: z.literal("room.reply"),
    version: z.literal(1),
    body: z.string().trim().min(1),
    final: z.literal(true),
  })
  .strict();
export function parseFinalReply(text) {
  assert.equal(typeof text, "string");
  assert.ok(
    Buffer.byteLength(text, "utf8") <= 65536,
    "Trial output exceeds its bounded buffer",
  );
  const value = JSON.parse(text);
  // JSON.parse otherwise silently accepts two conflicting intent fields.
  const keys = new Set();
  for (const match of text.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
    if (
      !text
        .slice(match.index + match[0].length)
        .trimStart()
        .startsWith(":")
    )
      continue;
    const key = JSON.parse(match[0]);
    assert.ok(!keys.has(key), "Duplicate envelope field");
    keys.add(key);
  }
  return schema.parse(value);
}
export function createFinalOutputTrial({
  workerApiOrigin,
  binding,
  sessionId,
  turnId,
  fetcher = fetch,
}) {
  for (const identity of [sessionId, turnId]) {
    assert.ok(
      typeof identity === "string" && identity.trim().length > 0,
      "Missing original native identity",
    );
  }
  const execution = new WorkerMcpExecution(workerApiOrigin, fetcher, binding);
  return async (terminal) => {
    assert.equal(terminal.sessionId, sessionId, "Foreign session");
    assert.equal(terminal.turnId, turnId, "Foreign original turn");
    assert.equal(
      terminal.status,
      "completed",
      "Not a proven successful native terminal",
    );
    assert.ok(
      Array.isArray(terminal.finalTexts) && terminal.finalTexts.length === 1,
      "Expected exactly one complete final candidate",
    );
    const intent = parseFinalReply(terminal.finalTexts[0]);
    // One stable slot for THIS transport and original Run; not a cross-facade
    // atomic exclusion against earlier or concurrent Worker CLI final writes.
    return execution.call("explicit-final-output/v1", {
      body: intent.body,
      final: true,
    });
  };
}
