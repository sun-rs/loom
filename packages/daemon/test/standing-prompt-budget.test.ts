import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKER_HELP_TOPIC_NAMES,
  formatBodiedWakeInput,
  providerActivationInput,
  workerTurnHandleLine,
} from "@rah-os/agent-host";

import {
  compileStandingPrompt,
  standingPromptLayers,
  type StandingPromptInput,
} from "../src/standing-prompt-compiler.ts";

/**
 * S1-c: the standing prompt is sent on every fresh session (inline in the user
 * turn for Kimi). Detail the model needs only occasionally is served on demand
 * by `worker help <topic>`; rules the code enforces are not restated as prose.
 */
// S1-g: tightened to the achieved size (max 9,832 total; platform 6,996 for
// an Agent, 7,253 on the legacy path) plus a small margin. The platform layer
// includes the byte-exact Raft memory body (3,221 chars) and its RAH bindings.
// Wake compaction (2026-09-24) raised the total by 400 (max now 10,399): the
// constant rules every wake used to repeat (~1,300 chars per turn, kept in
// native history forever) are stated here once instead, compressed to ~620
// chars. One session-start copy replaces a copy per turn.
// Final-reply turn end (2026-09-24) raised it by 100 (max now 10,497): one
// sentence naming `--final`, which saves a full-context generation per turn.
const STANDING_PROMPT_BUDGET_CHARS = 10_500;
const PLATFORM_LAYER_BUDGET_CHARS = 7_400;

const minimalInputs: readonly StandingPromptInput[] = (
  ["direct", "gated", "wait"] as const
).map((deliveryMode) => ({
  agent: { displayName: "A", handle: "a", participantId: "p", role: "R" },
  runtimeContext: { deliveryMode },
}));

test("the standing prompt for a minimal Agent stays within its character budget", () => {
  for (const input of [...minimalInputs, {}]) {
    const { prompt } = compileStandingPrompt(input);
    assert.ok(
      prompt.length <= STANDING_PROMPT_BUDGET_CHARS,
      `standing prompt is ${String(prompt.length)} chars (budget ${String(STANDING_PROMPT_BUDGET_CHARS)})`,
    );
    const platform = standingPromptLayers(input).find(
      (layer) => layer.id === "platform",
    )!;
    assert.ok(
      platform.text.length <= PLATFORM_LAYER_BUDGET_CHARS,
      `platform layer is ${String(platform.text.length)} chars (budget ${String(PLATFORM_LAYER_BUDGET_CHARS)})`,
    );
  }
});

test("the prompt no longer drives an extra turn after a successful reply", () => {
  for (const input of [...minimalInputs, {}]) {
    const { prompt } = compileStandingPrompt(input);
    assert.doesNotMatch(prompt, /and then acknowledge/u);
    assert.doesNotMatch(prompt, /separate obligation/u);
    assert.doesNotMatch(prompt, /inspect every delivered/u);
    assert.match(
      prompt,
      /Reply once with `message-post`; after a successful post your turn is done unless new work arrived\./u,
    );
  }
});

test("the prompt points at every on-demand help topic it relies on", () => {
  const { prompt } = compileStandingPrompt(minimalInputs[0]);
  const pointer =
    /Details: `loom-worker help <topic>` — topics: ([a-z, ]+)\./u.exec(prompt);
  assert.ok(pointer, "prompt carries the help pointer line");
  assert.deepEqual(
    pointer[1]!.split(", ").sort(),
    [...WORKER_HELP_TOPIC_NAMES].sort(),
  );
});

test("the prompt keeps the Human-decides-Tasks rule crisp", () => {
  const { prompt } = compileStandingPrompt(minimalInputs[0]);
  assert.match(prompt, /The Human decides what becomes a Task\./u);
  assert.match(
    prompt,
    /Answering a question, brief discussion, searching or reading files is a reply, not a Task: do not claim or create one for it\./u,
  );
});

/**
 * Wake compaction: every constant per-turn rule lives in the standing prompt,
 * stated exactly once, and the wake carries only the bodies, the reply seq and
 * (warm) the turn handle. History then grows by the bodies, not boilerplate.
 */
const MOVED_RULES: readonly RegExp[] = [
  /use the current environment, never a previous turn's Room, range or Worker path/giu,
  /Wake commands omit the `loom-worker` prefix/giu,
  /`msg=<ref>` is a short message id/giu,
  /pass a wake's `--turn <handle>` to every Worker command/giu,
  /On `Reply:`, post once with its `--based-on-room-seq`, no `message-check` first/giu,
  /With no reply needed, run `message-check` once/giu,
  /when a wake says `message-check first`, run it before replying/giu,
  /Never infer missing memory or no work from an error/giu,
  /Complete all your work before stopping/giu,
  /never poll for future peer replies/giu,
  /nor stop unfinished work merely because you posted progress/giu,
];

test("each rule moved out of the wake is stated exactly once in the standing prompt", () => {
  for (const input of [...minimalInputs, {}]) {
    const { prompt } = compileStandingPrompt(input);
    for (const rule of MOVED_RULES)
      assert.equal(
        [...prompt.matchAll(rule)].length,
        1,
        `${rule.source} in ${JSON.stringify(input)}`,
      );
  }
});

test("the final-reply rule is one sentence in the standing prompt and --final rides the wake's Reply line", () => {
  for (const input of [...minimalInputs, {}]) {
    const { prompt } = compileStandingPrompt(input);
    assert.equal(
      [
        ...prompt.matchAll(
          /Use `--final` on the post completing your reply to delivered messages; omit it on progress posts\./gu,
        ),
      ].length,
      1,
    );
    assert.equal([...prompt.matchAll(/--final/gu)].length, 1);
  }
  const [wake, warmWake] = wakeSamples();
  assert.match(
    wake!,
    /^Reply: message-post --target "#[a-z-]+" --based-on-room-seq 14 --final · /mu,
  );
  assert.match(warmWake!, /--based-on-room-seq 14 --final · /u);
});

const HANDLE = "AbCdEfGhIjKlMnOpQrStUv";
function wakeSamples(): string[] {
  const event = (
    roomSeq: number,
    type: string,
    payload: Record<string, unknown>,
  ) => ({
    eventId: `event-${roomSeq}`,
    roomId: "room-a",
    roomSeq,
    type,
    actorId: "p-owner",
    aggregateType: type.split(".")[0]!,
    aggregateId: `aggregate-${roomSeq}`,
    payload,
    idempotencyKey: `key-${roomSeq}`,
    schemaVersion: 1,
    createdAt: "2026-09-24T14:08:30.000Z",
  });
  const present = (through: number, noticeCount = 0) => ({
    fromSeq: 12,
    toSeq: 14,
    contentDigest: `sha256:${"a".repeat(64)}`,
    events: [
      event(12, "message.posted", {
        messageId: "message_eb064ecc-1111-4222-8333-444455556666",
        body: "hello",
      }),
      event(13, "task.cancelled", { taskId: "task-7" }),
      event(14, "message.posted", { messageId: "message-14", body: "hi" }),
    ].filter((item) => item.roomSeq <= through),
    presentedSeqs: [12, 13, 14].filter((seq) => seq <= through),
    presentedThroughSeq: through,
    noticeCount,
    ...(noticeCount === 0 ? {} : { noticeFromSeq: 13, noticeToSeq: 14 }),
    addressing: {
      targets: { "room-a": "#efficiency" },
      handles: { "p-owner": "owner" },
    },
    renderedAt: "2026-09-24T14:08:31.000Z",
  });
  return [
    formatBodiedWakeInput({ present: present(14) })!,
    formatBodiedWakeInput({ present: present(14), turnHandle: HANDLE })!,
    formatBodiedWakeInput({ present: present(12, 2) })!,
    providerActivationInput(""),
    providerActivationInput("", HANDLE),
    workerTurnHandleLine(HANDLE),
  ];
}

test("no wake repeats a standing-prompt sentence or the retired per-turn boilerplate", () => {
  const wakes = wakeSamples();
  for (const input of [...minimalInputs, {}]) {
    const { prompt } = compileStandingPrompt(input);
    const sentences = prompt
      .split(/(?<=[.!?])\s+|\n+/u)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 30);
    for (const wake of wakes)
      for (const sentence of sentences)
        assert.ok(!wake.includes(sentence), `wake repeats: ${sentence}`);
  }
  for (const wake of wakes) {
    for (const retired of [
      /Start this RAH OS Activation/u,
      /Complete all your work/u,
      /standing instructions/u,
      /finish this turn/u,
      /do not poll/iu,
      /Delivery:/u,
      /New messages? received/u,
      /time=|type=message\.posted/u,
    ])
      assert.doesNotMatch(wake, retired);
  }
});

test("the prompt does not restate the MEMORY.md read rule the memory binding owns", () => {
  for (const input of [...minimalInputs, {}]) {
    const { prompt } = compileStandingPrompt(input);
    assert.doesNotMatch(prompt, /Read MEMORY\.md \(at process\.env/u);
    assert.doesNotMatch(prompt, /you do not need to poll/iu);
  }
});

test("redundant reads are handled by tool behaviour, not by prompt rules (owner ruling 2026-09-29)", () => {
  // message-read references bodies the sent wake already delivered instead of
  // repeating them (worker-read-tools deliveredInWakeSeqs).
  const { prompt } = compileStandingPrompt(minimalInputs[0]);
  assert.doesNotMatch(prompt, /re-fetch delivered bodies/u);
  assert.doesNotMatch(prompt, /inspect the Worker executable/u);
});
