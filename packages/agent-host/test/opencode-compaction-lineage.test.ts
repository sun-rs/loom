import assert from "node:assert/strict";
import test from "node:test";
import { openCodeCompactionParent } from "../src/opencode-compaction-lineage.js";

function fixture() {
  const sessionID = "session";
  const user = (id: string, part: object) => ({
    info: { id, sessionID, role: "user" },
    parts: [{ id: "part-" + id, messageID: id, sessionID, ...part }],
  });
  const assistant = (id: string, parentID: string, summary = false) => ({
    info: {
      id,
      sessionID,
      role: "assistant",
      parentID,
      summary,
      time: { completed: 2 },
      finish: "stop",
    },
    parts: [
      {
        id: "part-" + id,
        messageID: id,
        sessionID,
        type: "text",
        text: "done",
        time: { end: 2 },
      },
    ],
  });
  const messages = [
    user("original", { type: "text", text: "task" }),
    assistant("accepted", "original"),
    user("compact", { type: "compaction", auto: true, overflow: false }),
    assistant("summary", "compact", true),
    user("continue", {
      type: "text",
      synthetic: true,
      metadata: { compaction_continue: true },
      text: "Continue",
    }),
    assistant("final", "continue"),
  ];
  return {
    messages,
    response: messages.at(-1)!,
    expected: { sessionId: sessionID, parentId: "original" },
  };
}
test("native compaction summary and synthetic continuation prove a new final parent", () => {
  const f = fixture();
  assert.equal(
    openCodeCompactionParent(f.response, f.messages, f.expected),
    "continue",
  );
});
test("missing original, summary, continuation or current final cannot prove the turn", () => {
  for (const index of [0, 1, 2, 3, 4, 5]) {
    const f = fixture();
    f.messages.splice(index, 1);
    assert.equal(
      openCodeCompactionParent(f.response, f.messages, f.expected),
      undefined,
    );
  }
});
test("foreign session, ordinary Human, unfinished summary and prior turn are refused", () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.messages[3]!.info.sessionID = "foreign";
    },
    (f: ReturnType<typeof fixture>) => {
      delete (f.messages[4]!.parts[0] as any).synthetic;
    },
    (f: ReturnType<typeof fixture>) => {
      delete (f.messages[4]!.parts[0] as any).metadata;
    },
    (f: ReturnType<typeof fixture>) => {
      delete (f.messages[3]!.info as any).time.completed;
    },
    (f: ReturnType<typeof fixture>) => {
      (f.messages[3]!.info as any).summary = false;
    },
    (f: ReturnType<typeof fixture>) => {
      (f.messages[5]!.info as any).parentID = "old-turn";
    },
    (f: ReturnType<typeof fixture>) => {
      f.messages.push(f.messages[0]!);
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(
      openCodeCompactionParent(f.response, f.messages, f.expected),
      undefined,
    );
  }
});
