import assert from "node:assert/strict";
import test from "node:test";
import { AgyStream } from "../src/agy-stream.mjs";
const init = {
  event: "init",
  conversation_id: "s",
  init: { model: "model-low" },
};
const step = (i, type, state = "DONE", rest = {}) => ({
  event: "step_update",
  step_update: {
    conversation_id: "s",
    step_index: i,
    step_type: type,
    state,
    ...rest,
  },
});
const usage = {
  input_tokens: 20,
  output_tokens: 4,
  thinking_tokens: 1,
  cache_read_tokens: 10,
  total_tokens: 34,
};
const final = {
  event: "result",
  result: {
    conversation_id: "s",
    status: "SUCCESS",
    response: "verified",
    usage,
  },
};
function ready() {
  const p = new AgyStream({ model: "model-low", resumeSession: "s" });
  p.push(init);
  p.push(step(7, "user_input"));
  p.push(step(8, "agent_response", "DONE", { usage }));
  return p;
}
test("AGY exact session input and final are scoped to current launch; aggregate usage is not counted twice", () => {
  const p = ready();
  const r = p.push(final);
  assert.equal(r.final.text, "verified");
  assert.equal(r.final.turnId, "s:7");
  assert.equal(p.finish().text, "verified");
  const q = new AgyStream({ model: "model-low" });
  q.push(init);
  q.push(step(0, "user_input"));
  const a = q.push(step(1, "agent_response", "DONE", { usage }));
  assert.equal(a.usage.inputTokens, 30);
  assert.equal(a.usage.outputTokens, 4);
  assert.deepEqual(q.push(step(1, "agent_response", "DONE", { usage })), {});
});
test("AGY rejects replacement sessions, wrong models, missing input/result, errors and a second user turn", () => {
  assert.throws(() =>
    new AgyStream({ model: "model-low", resumeSession: "old" }).push(init),
  );
  assert.throws(() => new AgyStream({ model: "other" }).push(init));
  assert.throws(() => ready().finish());
  const p = new AgyStream({ model: "model-low" });
  p.push(init);
  assert.throws(() => p.push(final));
  assert.throws(() => ready().push(step(9, "user_input")));
  assert.throws(() =>
    ready().push({ ...final, result: { ...final.result, status: "ERROR" } }),
  );
});
