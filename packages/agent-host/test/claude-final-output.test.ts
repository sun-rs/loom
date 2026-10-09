import assert from "node:assert/strict";
import test from "node:test";
import { createClaudeFinalOutput } from "../src/claude-final-output.js";
const wrap = (frame: any) => ({
  session_id: "session",
  parent_tool_use_id: null,
  ...frame,
});
const stream = (event: any) => wrap({ type: "stream_event", event });
const start = (id = "message") =>
  stream({ type: "message_start", message: { id } });
const assistant = (content: any[] = [{ type: "text", text: "done" }]) =>
  wrap({ type: "assistant", message: { id: "message", content } });
const stop = (reason = "end_turn") => [
  stream({ type: "message_delta", delta: { stop_reason: reason } }),
  stream({ type: "message_stop" }),
];
const result = (fields = {}) =>
  wrap({
    type: "result",
    subtype: "success",
    is_error: false,
    stop_reason: "end_turn",
    user_message_uuid: "input",
    result: "done",
    ...fields,
  });
const valid = () => [start(), assistant(), ...stop(), result()];
const collect = (frames: any[]) => {
  const c = createClaudeFinalOutput({
    sessionId: "session",
    inputUuid: "input",
  });
  frames.forEach(c.observe);
  return c;
};
test("native final needs complete same-session stream and exact input result", () => {
  assert.equal(collect(valid().slice(0, -1)).candidate(), undefined);
  assert.deepEqual(collect(valid()).candidate(), {
    text: "done",
    nativeMessageId: "message",
  });
});
test("reject missing/wrong session, subagent, replay, failed/ambiguous result and incomplete stream", () => {
  const cases = [
    [assistant(), ...stop(), result()],
    [
      start(),
      stream({ type: "error", error: { message: "failed" } }),
      assistant(),
      ...stop(),
      result(),
    ],
    [
      start(),
      wrap({ type: "error", error: { message: "failed" } }),
      assistant(),
      ...stop(),
      result(),
    ],
    [start(), assistant(), result()],
    [start(), assistant(), ...stop("max_tokens"), result()],
    valid().map((f) => ({ ...f, session_id: "other" })),
    valid().map((f) => ({ ...f, session_id: undefined })),
    valid().map((f) => ({ ...f, parent_tool_use_id: "subagent" })),
    [start(), { ...assistant(), isReplay: true }, ...stop(), result()],
    [...valid().slice(0, -1), result({ user_message_uuid: "other" })],
    [...valid().slice(0, -1), result({ user_message_uuid: undefined })],
    [
      ...valid().slice(0, -1),
      result({ user_message_uuids: ["input", "busy"] }),
    ],
    [...valid().slice(0, -1), result({ is_error: true })],
    [...valid().slice(0, -1), result({ result: "different" })],
    [
      start(),
      assistant([{ type: "text", text: "x".repeat(65537) }]),
      ...stop(),
      result(),
    ],
    [
      start(),
      assistant(),
      assistant([{ type: "text", text: "other" }]),
      ...stop(),
      result(),
    ],
    [...valid().slice(0, -1), start("another"), result()],
  ];
  for (const frames of cases)
    assert.equal(
      collect(frames).candidate(),
      undefined,
      JSON.stringify(frames).slice(0, 100),
    );
});
test("tools must settle; intermediate text never becomes final; busy admission invalidates", () => {
  const tool = assistant([
    { type: "text", text: "working" },
    { type: "tool_use", id: "tool", name: "Bash" },
  ]);
  const prefix = [start(), tool, ...stop("tool_use")];
  const final = [
    start("final"),
    {
      ...assistant(),
      message: { id: "final", content: [{ type: "text", text: "done" }] },
    },
    ...stop(),
    result(),
  ];
  assert.equal(collect([...prefix, ...final]).candidate(), undefined);
  const c = collect([
    ...prefix,
    wrap({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "tool" }] },
    }),
    ...final,
  ]);
  assert.deepEqual(c.candidate(), { text: "done", nativeMessageId: "final" });
  c.invalidate();
  assert.equal(c.candidate(), undefined);
});
