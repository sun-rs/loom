import assert from "node:assert/strict";
import test from "node:test";
import { validateInlineChannelRound } from "./multi-channel-inline-validation.mjs";
const evidenceText = "UNIQUE MATERIAL\ncomplete source\n";
const round = {
  speaker: "a",
  sessionId: "session-a",
  answer: "exact",
  startedAt: "2026-10-05T00:00:01Z",
  finishedAt: "2026-10-05T00:00:03Z",
};
const row = (
  text = evidenceText,
  role = "user",
  timestamp = "2026-10-05T00:00:02Z",
) => ({
  type: "response_item",
  timestamp,
  payload: { type: "message", role, content: [{ type: "input_text", text }] },
});
const options = (changes = {}) => ({
  round,
  previousRounds: [],
  events: [row()],
  evidenceText,
  expectedAnswer: "exact",
  ...changes,
});
test("first input contains complete material exactly once", () => {
  assert.deepEqual(validateInlineChannelRound(options()), {
    answer: "exact",
    readProof: "complete-inline-input",
  });
  for (const events of [
    [],
    [row("UNIQUE MATERIAL")],
    [row(evidenceText.repeat(2))],
    [row(evidenceText, "assistant")],
    [row(evidenceText, "developer")],
    [row(evidenceText, "user", "2026-10-05T00:00:00Z")],
  ])
    assert.throws(
      () => validateInlineChannelRound(options({ events })),
      /material|input/i,
    );
});
test("continuation requires an input and rejects retransmitted material", () => {
  const previousRounds = [
    {
      ...round,
      startedAt: "2026-10-04T00:00:01Z",
      finishedAt: "2026-10-04T00:00:03Z",
      validation: { answer: "exact", readProof: "complete-inline-input" },
    },
  ];
  assert.equal(
    validateInlineChannelRound(
      options({ previousRounds, events: [row("next question")] }),
    ).readProof,
    "previous-turn-only",
  );
  assert.throws(
    () => validateInlineChannelRound(options({ previousRounds })),
    /material|repeat/i,
  );
  assert.throws(
    () => validateInlineChannelRound(options({ previousRounds, events: [] })),
    /input/i,
  );
});
test("all tools and unknown response items fail closed", () => {
  for (const type of [
    "function_call",
    "custom_tool_call",
    "web_search_call",
    "local_shell_call",
    "future_tool",
  ])
    assert.throws(
      () =>
        validateInlineChannelRound(
          options({
            events: [
              row(),
              {
                type: "response_item",
                timestamp: row().timestamp,
                payload: { type },
              },
            ],
          }),
        ),
      /tool|unsupported/i,
    );
});
test("answer and time bounds are strict", () => {
  assert.throws(
    () =>
      validateInlineChannelRound(
        options({ round: { ...round, answer: "exact\n" } }),
      ),
    /answer/i,
  );
  assert.throws(
    () =>
      validateInlineChannelRound(
        options({ round: { ...round, startedAt: "invalid" } }),
      ),
    /time/i,
  );
  assert.throws(
    () => validateInlineChannelRound(options({ evidenceText: "" })),
    /material/i,
  );
});

test("invalid timestamp cannot hide a tool", () => {
  assert.throws(
    () =>
      validateInlineChannelRound(
        options({
          events: [
            row(),
            {
              type: "response_item",
              timestamp: "invalid",
              payload: { type: "function_call" },
            },
          ],
        }),
      ),
    /time/i,
  );
});
test("continuation proof cannot borrow a different session or current round", () => {
  const previous = {
    ...round,
    startedAt: "2026-10-04T00:00:01Z",
    finishedAt: "2026-10-04T00:00:03Z",
    validation: { answer: "exact", readProof: "complete-inline-input" },
  };
  for (const previousRounds of [
    [round],
    [{ ...previous, speaker: "b" }],
    [{ ...previous, sessionId: "session-b" }],
    [{ ...previous, validation: undefined }],
    [{ ...previous, validationError: "failed" }],
  ])
    assert.throws(
      () =>
        validateInlineChannelRound(
          options({ previousRounds, events: [row("next")] }),
        ),
      /previous|continuation/i,
    );
});
