import assert from "node:assert/strict";
import test from "node:test";
import { validateLongChannelRound } from "./multi-channel-long-validation.mjs";

const evidenceText = "first evidence line\nlast evidence line\n";
const round = {
  speaker: "a",
  answer: "审查结论：stable=reject",
  startedAt: "2026-10-05T00:00:01.000Z",
  finishedAt: "2026-10-05T00:00:03.000Z",
};
const row = (payload, timestamp = "2026-10-05T00:00:02.000Z") => ({
  type: "response_item",
  timestamp,
  payload,
});
function events(
  input = 'const r = await tools.exec_command({cmd:"cat evidence.txt",max_output_tokens:20000}); text(r.output);',
  output = evidenceText,
) {
  return [
    row({ type: "custom_tool_call", name: "exec", call_id: "read-1", input }),
    row({
      type: "custom_tool_call_output",
      call_id: "read-1",
      output: [
        { type: "input_text", text: "Script completed\n" },
        { type: "input_text", text: output },
      ],
    }),
  ];
}
const options = (changes = {}) => ({
  round,
  previousRounds: [],
  events: events(),
  expectedAnswer: round.answer,
  evidenceText,
  ...changes,
});

test("first turn requires a correlated full read and exact canonical answer", () => {
  assert.equal(
    validateLongChannelRound(options()).readProof,
    "complete-tool-result",
  );
  assert.throws(
    () => validateLongChannelRound(options({ events: [] })),
    /read|tool/i,
  );
  assert.throws(
    () =>
      validateLongChannelRound(
        options({ events: events(undefined, "first evidence line\n") }),
      ),
    /complete|evidence/i,
  );
  const mismatch = events();
  mismatch[1].payload.call_id = "someone-else";
  assert.throws(
    () => validateLongChannelRound(options({ events: mismatch })),
    /correlat|result/i,
  );
  assert.throws(
    () =>
      validateLongChannelRound(
        options({ round: { ...round, answer: round.answer + "\nextra" } }),
      ),
    /answer/i,
  );
  assert.throws(
    () =>
      validateLongChannelRound(
        options({ round: { ...round, answer: " " + round.answer } }),
      ),
    /answer/i,
  );
});

test("continued turns cannot reuse old read evidence or perform new tools", () => {
  const previousRounds = [{ speaker: "a" }];
  assert.equal(
    validateLongChannelRound(options({ previousRounds, events: [] })).readProof,
    "previous-turn-only",
  );
  assert.throws(
    () =>
      validateLongChannelRound(options({ previousRounds, events: events() })),
    /tool|read/i,
  );
  assert.throws(
    () =>
      validateLongChannelRound(
        options({
          events: events().map((x) => ({
            ...x,
            timestamp: "2026-10-05T00:00:00.000Z",
          })),
        }),
      ),
    /read|tool/i,
  );
  assert.throws(
    () =>
      validateLongChannelRound(options({ previousRounds: [{ speaker: "b" }] })),
    /participant|speaker/i,
  );
});

test("tool boundary rejects extra execution, duplicate results and truncated/replayed evidence", () => {
  for (const input of [
    'const r=await tools.exec_command({cmd:"cat evidence.txt; echo extra"});text(r.output);',
    'const r=await tools.exec_command({cmd:"cat evidence.txt"});await tools.exec_command({cmd:"pwd"});text(r.output);',
    'const r=await tools.exec_command({cmd:"cat other.txt"});text(r.output);',
    'for(let i=0;i<2;i++){text(await tools.exec_command({cmd:"cat evidence.txt"}));}',
  ])
    assert.throws(
      () => validateLongChannelRound(options({ events: events(input) })),
      /read|command|tool/i,
    );
  const duplicate = events();
  duplicate.push(duplicate[1]);
  assert.throws(
    () => validateLongChannelRound(options({ events: duplicate })),
    /result/i,
  );
  assert.throws(
    () =>
      validateLongChannelRound(
        options({ events: events(undefined, evidenceText + evidenceText) }),
      ),
    /once|evidence/i,
  );
});

test("direct exec_command full output is accepted without running supplied code", () => {
  const direct = [
    row({
      type: "function_call",
      name: "exec_command",
      call_id: "d",
      arguments: JSON.stringify({
        cmd: "cat evidence.txt",
        max_output_tokens: 20000,
      }),
    }),
    row({
      type: "function_call_output",
      call_id: "d",
      output: "Process exited with code 0\nOutput:\n" + evidenceText,
    }),
  ];
  assert.equal(
    validateLongChannelRound(options({ events: direct })).readProof,
    "complete-tool-result",
  );
  const malicious = events(
    "text(await tools.exec_command({cmd:process.env.SECRET}));",
  );
  assert.throws(
    () => validateLongChannelRound(options({ events: malicious })),
    /read|command|tool/i,
  );
});

test("unregistered namespaces cannot impersonate the registered read tool", () => {
  for (const name of ["other.exec", "other.exec_command"]) {
    const forged = events();
    forged[0].payload.name = name;
    assert.throws(
      () => validateLongChannelRound(options({ events: forged })),
      /tool/i,
    );
  }
});

test("built-in or unknown response tool items cannot bypass the read-only boundary", () => {
  for (const type of [
    "web_search_call",
    "local_shell_call",
    "new_unknown_tool",
  ]) {
    const extra = row({ type });
    assert.throws(
      () => validateLongChannelRound(options({ events: [...events(), extra] })),
      /unsupported|tool/i,
    );
    assert.throws(
      () =>
        validateLongChannelRound(
          options({ previousRounds: [{ speaker: "a" }], events: [extra] }),
        ),
      /unsupported|tool/i,
    );
  }
});
