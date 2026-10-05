import { finalOutputInstructions } from "../src/final-output-instructions.js";
import assert from "node:assert/strict";
import test from "node:test";
import { openCodeFinalOutputCandidate } from "../src/opencode-final-output.js";

test("OpenCode final-output system exception is opt-in and preserves ordinary Worker operations", () => {
  assert.equal(
    finalOutputInstructions("original rules", false),
    "original rules",
  );
  const text = finalOutputInstructions("original rules", true);
  assert.ok(text.startsWith("original rules\n"));
  assert.match(text, /wake selects final-output/);
  assert.match(
    text,
    /\{"kind":"room.reply","version":1,"body":"\.\.\.","final":true,"basedOnRoomSeq":123\}/,
  );
  assert.match(
    text,
    /exact --based-on-room-seq value from the current Reply context/,
  );
  assert.match(text, /Other operations retain the Worker tools/);
  assert.match(text, /complete all current work/);
  assert.match(text, /progress, attachments, other targets/);
  assert.match(text, /wakes without this selection/);
  assert.match(text, /do not also post.*through a tool/);
});

const expected = { sessionId: "session-original", parentId: "input-original" };
function response(
  text = '{"kind":"room.reply","version":1,"body":"你好🌿","final":true}',
) {
  return {
    info: {
      id: "assistant-final",
      role: "assistant",
      sessionID: expected.sessionId,
      parentID: expected.parentId,
      time: { completed: 123 },
      finish: "stop",
    },
    parts: [
      {
        id: "part-final",
        type: "text",
        messageID: "assistant-final",
        sessionID: expected.sessionId,
        text,
      },
    ],
  };
}
test("OpenCode extracts only the complete original assistant text without parsing business schema", () => {
  const value = response("ordinary diagnostic prose");
  assert.deepEqual(openCodeFinalOutputCandidate(value, expected), {
    text: value.parts[0]!.text,
    nativeMessageId: value.info.id,
  });
});
test("OpenCode rejects foreign, nonterminal, failed and truncated assistants even with complete JSON", () => {
  for (const patch of [
    { sessionID: "foreign" },
    { parentID: "foreign" },
    { role: "user" },
    { id: "" },
    { time: {} },
    { time: { completed: NaN } },
    { finish: "length" },
    { finish: "tool-calls" },
    { finish: undefined },
    { error: { name: "MessageAbortedError" } },
  ]) {
    const value = response();
    assert.equal(
      openCodeFinalOutputCandidate(
        { ...value, info: { ...value.info, ...patch } },
        expected,
      ),
      undefined,
    );
  }
});
test("OpenCode never joins text parts or substitutes reasoning/tool diagnostics", () => {
  const value = response();
  for (const parts of [
    [],
    [...value.parts, ...value.parts],
    [{ ...value.parts[0], type: "reasoning" }],
    [{ ...value.parts[0], messageID: "foreign" }],
    [{ ...value.parts[0], sessionID: "foreign" }],
    [{ ...value.parts[0], id: "" }],
    [{ ...value.parts[0], text: "" }],
  ]) {
    assert.equal(
      openCodeFinalOutputCandidate({ ...value, parts }, expected),
      undefined,
    );
  }
  assert.deepEqual(
    openCodeFinalOutputCandidate(
      {
        ...value,
        parts: [{ type: "reasoning", text: "not output" }, ...value.parts],
      },
      expected,
    ),
    { text: value.parts[0]!.text, nativeMessageId: value.info.id },
  );
});
test("OpenCode applies the 64 KiB limit to UTF-8 bytes without truncating", () => {
  const text = "界".repeat(21845) + "x";
  assert.equal(Buffer.byteLength(text), 65536);
  assert.equal(
    openCodeFinalOutputCandidate(response(text), expected)?.text,
    text,
  );
  assert.equal(
    openCodeFinalOutputCandidate(response(text + "x"), expected),
    undefined,
  );
});

test("missing original identity cannot match equally missing response identity", () => {
  const value = response();
  const binding = { sessionId: "", parentId: "" };
  value.info.sessionID = "";
  value.info.parentID = "";
  value.parts[0]!.sessionID = "";
  assert.equal(openCodeFinalOutputCandidate(value, binding), undefined);
});
