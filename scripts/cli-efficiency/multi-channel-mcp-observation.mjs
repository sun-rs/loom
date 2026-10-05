import assert from "node:assert/strict";
import {
  replyArguments,
  validateMcpInlineRound,
} from "./multi-channel-mcp-validation.mjs";
import { summarizeLongChannel } from "./multi-channel-long-summary.mjs";

// Registered non-writing rejection from Kernel worker-message-routing.ts.
// Unknown errors/results are not assumed safe. Never execute provider source.
function targetRejection(output) {
  const texts =
    typeof output === "string"
      ? [output]
      : (output ?? [])
          .filter((x) => x.type === "input_text")
          .map((x) => x.text);
  const results = [];
  for (const text of texts) {
    try {
      const value = JSON.parse(text);
      if (Array.isArray(value?.content)) results.push(value);
    } catch {}
  }
  assert.equal(results.length, 1, "missing unique rejection result");
  assert.deepEqual(
    results[0],
    {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: {
              code: "forbidden",
              message: "Thread is outside this Worker execution scope",
            },
          }),
        },
      ],
    },
    "unregistered rejection; outcome unknown",
  );
}
export function validateMcpObservationRound(options) {
  if (options.armKind !== "worker-mcp") return validateMcpInlineRound(options);
  const { round, events, expectedAnswer } = options;
  const start = Date.parse(round.startedAt),
    end = Date.parse(round.finishedAt);
  assert.ok(
    Number.isFinite(start) && Number.isFinite(end) && start <= end,
    "invalid time bounds",
  );
  const tools = events.filter(
    (e) =>
      e.type === "response_item" &&
      Date.parse(e.timestamp) >= start &&
      Date.parse(e.timestamp) <= end &&
      !["message", "reasoning"].includes(e.payload?.type),
  );
  assert.ok(
    tools.length >= 2 && tools.length % 2 === 0,
    "incomplete tool evidence",
  );
  const ids = new Set(),
    removed = new Set();
  for (let i = 0; i < tools.length; i += 2) {
    const call = tools[i].payload,
      output = tools[i + 1].payload;
    assert.ok(
      ["function_call", "custom_tool_call"].includes(call.type),
      "unsupported call order",
    );
    assert.ok(
      typeof call.call_id === "string" &&
        call.call_id &&
        !ids.has(call.call_id),
      "duplicate or missing call id",
    );
    ids.add(call.call_id);
    assert.equal(output.call_id, call.call_id, "uncorrelated output");
    assert.equal(
      output.type,
      call.type === "function_call"
        ? "function_call_output"
        : "custom_tool_call_output",
      "unsupported output",
    );
    assert.ok(
      Date.parse(tools[i].timestamp) <= Date.parse(tools[i + 1].timestamp),
      "receipt before call",
    );
    if (i === tools.length - 2) break;
    const args = replyArguments(call);
    assert.ok(
      typeof args.threadId === "string" && args.threadId.length > 0,
      "rejection lacks explicit target",
    );
    assert.deepEqual(
      args,
      {
        body: expectedAnswer,
        final: true,
        basedOnRoomSeq: round.humanRoomSeq,
        threadId: args.threadId,
      },
      "unregistered rejected arguments",
    );
    targetRejection(output.output);
    removed.add(tools[i]);
    removed.add(tools[i + 1]);
  }
  // Reuse all final receipt, current target, exact answer, material, and Run
  // invariants. Removing inspected diagnostic items never changes usage/history.
  const proof = validateMcpInlineRound({
    ...options,
    events: events.filter((e) => !removed.has(e)),
  });
  return {
    ...proof,
    replyProof: "observed-mcp-final-reply",
    reliability: {
      calls: tools.length / 2,
      rejectedTargetCalls: removed.size / 2,
      firstCallSucceeded: removed.size === 0,
      finallyDelivered: true,
    },
  };
}
export function summarizeMcpObservation(arms) {
  const summary = summarizeLongChannel(arms, {
    readProofPolicy: "inline-input/v1",
    productArm: "worker-mcp",
    mcpReplyProof: "observed-mcp-final-reply",
  });
  const rounds = arms?.["worker-mcp"]?.rounds ?? [];
  const validated = rounds.filter(
    (r) =>
      !r.validationError &&
      r.validation?.replyProof === "observed-mcp-final-reply" &&
      r.validation.reliability?.finallyDelivered === true,
  );
  return {
    ...summary,
    stabilityVerdict: "not-established",
    reliability: {
      observedStages: rounds.length,
      validatedStages: validated.length,
      unvalidatedStages: rounds.length - validated.length,
      firstCallSuccesses: validated.filter(
        (r) => r.validation.reliability.firstCallSucceeded,
      ).length,
      recoveredStages: validated.filter(
        (r) => !r.validation.reliability.firstCallSucceeded,
      ).length,
      rejectedTargetCalls: validated.reduce(
        (n, r) => n + r.validation.reliability.rejectedTargetCalls,
        0,
      ),
    },
    interpretation:
      summary.interpretation +
      " Recovery costs are retained. Within-session stages are correlated observations, not independent repetitions. No stability claim from one batch.",
  };
}
