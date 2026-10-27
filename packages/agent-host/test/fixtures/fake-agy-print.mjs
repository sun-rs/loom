#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const a = process.argv.slice(2),
  get = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
if (process.env.AGY_FAKE_RECORD)
  appendFileSync(process.env.AGY_FAKE_RECORD, JSON.stringify(a) + "\n");
const mode = process.env.AGY_FAKE_MODE;
const id =
  mode === "replace" ? "other" : get("--conversation") || "agy-session";
const emit = (f) => process.stdout.write(JSON.stringify(f) + "\n");
emit({ event: "init", conversation_id: id, init: { model: get("--model") } });
const step = (i, t, state = "DONE", extra = {}) =>
  emit({
    event: "step_update",
    step_update: {
      conversation_id: id,
      step_index: i,
      step_type: t,
      state,
      ...extra,
    },
  });
step(0, "user_input");
step(1, "agent_response", "DONE", {
  usage: {
    input_tokens: 10,
    output_tokens: 3,
    cache_read_tokens: 2,
    thinking_tokens: 0,
  },
});
if (mode === "hang") setInterval(() => {}, 1000);
else if (mode !== "truncated")
  emit({
    event: "result",
    result: {
      conversation_id: id,
      status: mode === "failed" ? "ERROR" : "SUCCESS",
      response: "完成中文😀",
      usage: {
        input_tokens: 10,
        output_tokens: 3,
        cache_read_tokens: 2,
        thinking_tokens: 0,
      },
    },
  });
