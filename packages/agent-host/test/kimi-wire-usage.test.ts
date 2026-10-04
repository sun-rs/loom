import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { ProviderUsageFrameSchema } from "@rah-os/protocol";

import {
  kimiMainWirePath,
  kimiTurnUsage,
  kimiWireBaseline,
  kimiWireSize,
  readKimiTurnUsage,
} from "../src/kimi-wire-usage.js";

/**
 * evo §40: Kimi usage from the session wire. Fixture: the real kimi-code
 * 0.39.1 ACP session wire kept for the efficiency gate (summaries trimmed),
 * split into the regions each prompt appended.
 */
const FIXTURE = fileURLToPath(
  new URL(
    "../../../scripts/cli-efficiency/fixtures/kimi-acp-0.39-session/wire.jsonl",
    import.meta.url,
  ),
);
const lines = readFileSync(FIXTURE, "utf8").split("\n");
const region = (from: number, through: number) =>
  lines.slice(from, through + 1).join("\n") + "\n";
const at = () => Date.parse("2026-09-26T01:00:00.000Z");
/**
 * Review 2026-09-26 P2-2: kimi-code 0.39.1 logs `prompt.accepted` and
 * `turn.prompt` (the prompt's input parts, text passed through from the ACP
 * text block) before the turn's first `step.begin`; the fixture dropped both
 * (they carry prompt text), so tests put them back where the real wire has
 * them. Step events carry `turnId` (string) and `turn.ended` the same number.
 */
const PROMPT = "FAKE Kimi prompt of this run";
const promptRecords = (text = PROMPT) => [
  JSON.stringify({
    type: "prompt.accepted",
    agentId: "main",
    promptId: "msg_fake",
    content: [{ type: "text", text }],
  }),
  JSON.stringify({
    type: "turn.prompt",
    agentId: "main",
    input: [{ type: "text", text }],
    origin: { kind: "user" },
  }),
];
/** A real turn's lines with its prompt records before the first step. */
const turnRegion = (from: number, through: number, text = PROMPT) => {
  const body = lines.slice(from, through + 1);
  const first = body.findIndex((line) => line.includes('"step.begin"'));
  const cut = first < 0 ? 0 : first;
  return (
    [...body.slice(0, cut), ...promptRecords(text), ...body.slice(cut)].join(
      "\n",
    ) + "\n"
  );
};
const stable = (usages: { observedAt: string }[]) =>
  usages.map(({ observedAt: _observedAt, ...rest }) => rest);

test("a completed prompt yields one generation per step.end usage, with the provider message id", () => {
  // Real turn 2: two steps, completed.
  const turn = kimiTurnUsage(turnRegion(30, 42), {
    now: at,
    promptText: PROMPT,
  });
  assert.equal(turn.ended, true);
  assert.deepEqual(turn.gaps, []);
  assert.deepEqual(stable(turn.usages), [
    {
      provider: "kimi-acp/v1",
      responseId: "chatcmpl-9GSbwJc98s8Xy6PnRUDVXHUf",
      inputTokens: 223 + 24832,
      cachedInputTokens: 24832,
      outputTokens: 77,
      reasoningOutputTokens: null,
      contextWindow: null,
      contextUsedTokens: null,
    },
    {
      provider: "kimi-acp/v1",
      responseId: "chatcmpl-Ef9ZC0ooBV5HCOfCfJXXrsEw",
      inputTokens: 596 + 24832,
      cachedInputTokens: 24832,
      outputTokens: 63,
      reasoningOutputTokens: null,
      contextWindow: null,
      contextUsedTokens: null,
    },
  ]);
  for (const usage of turn.usages)
    ProviderUsageFrameSchema.parse({
      protocol: "rah-provider-usage/v1",
      ...usage,
    });
});

test("a requested step interrupted without usage preserves finished sums and reports a capture gap", () => {
  // Real turn 0 (session start lines included): steps 1-2 finished, step 3
  // cancelled before usage.
  const turn = kimiTurnUsage(turnRegion(0, 18), {
    now: at,
    promptText: PROMPT,
  });
  assert.equal(turn.ended, true);
  assert.deepEqual(
    turn.gaps.map((gap) => gap.reason),
    ["parse_error"],
  );
  assert.deepEqual(
    turn.usages.map((usage) => [usage.responseId, usage.inputTokens]),
    [
      ["chatcmpl-nZwdJY6YAFnsvaZVPqZvmkbz", 4575 + 19456],
      ["chatcmpl-r0NhQCFpwDbn5seXuFVqydW3", 419 + 23808],
    ],
  );
});

test("a compaction-only prompt yields the compaction's own model call and ends with the compaction", () => {
  // Real manual compaction: no prompt records, begin..complete. Only the
  // settled prompt (independent proof) makes it the whole prompt.
  const turn = kimiTurnUsage(region(67, 74), { now: at, promptSettled: true });
  assert.equal(turn.ended, true);
  assert.deepEqual(turn.gaps, []);
  assert.equal(turn.usages.length, 1);
  assert.match(turn.usages[0]!.responseId, /^compaction:/u);
  assert.equal(turn.usages[0]!.inputTokens, 1023 + 26368);
  assert.equal(turn.usages[0]!.cachedInputTokens, 26368);
  assert.equal(turn.usages[0]!.outputTokens, 523);
});

test("a compaction without a settled prompt is not proof that the prompt ended", () => {
  const turn = kimiTurnUsage(region(67, 74), { now: at });
  assert.equal(turn.ended, false);
  assert.deepEqual(turn.usages, []);
});

test("a compaction inside this turn does not end it: generation after it is still this turn's", () => {
  // Auto compaction after this prompt's records, steps not yet flushed.
  const compacted = [...promptRecords(), ...lines.slice(69, 75)].join("\n");
  const early = kimiTurnUsage(`${compacted}\n`, {
    now: at,
    promptText: PROMPT,
    promptSettled: true,
  });
  assert.equal(early.ended, false, "no turn end yet");
  // The continued generation lands later: the whole turn is attributed.
  const late = kimiTurnUsage(
    `${compacted}\n${lines.slice(75, 90).join("\n")}\n`,
    { now: at, promptText: PROMPT },
  );
  assert.equal(late.ended, true);
  // The fixture also issued step 5.3 before final cancellation, without usage.
  assert.deepEqual(
    late.gaps.map((gap) => gap.reason),
    ["parse_error"],
  );
  assert.equal(late.usages.length, 3);
  assert.match(late.usages[0]!.responseId, /^compaction:/u);
  assert.deepEqual(
    late.usages.slice(1).map((usage) => usage.responseId),
    ["chatcmpl-CG2cBwFfI65pVi2Zwmr6voAz", "chatcmpl-TyX45DdznrEoLPB4jlWGHxpW"],
  );
});

test("a late tail of the previous turn before this prompt's records is never attributed", () => {
  // Turn 0's last finished step, cancelled step and end land after the
  // baseline, then this prompt's turn 2.
  const text = `${region(14, 19)}${turnRegion(31, 42)}`;
  const turn = kimiTurnUsage(text, { now: at, promptText: PROMPT });
  assert.equal(turn.ended, true);
  assert.deepEqual(turn.gaps, []);
  assert.deepEqual(
    turn.usages.map((usage) => usage.responseId),
    ["chatcmpl-9GSbwJc98s8Xy6PnRUDVXHUf", "chatcmpl-Ef9ZC0ooBV5HCOfCfJXXrsEw"],
  );
  // Without this prompt's identity the start is unproven: a gap.
  const unproven = kimiTurnUsage(text, { now: at });
  assert.deepEqual(
    unproven.gaps.map((entry) => entry.reason),
    ["parse_error"],
  );
});

test("two consecutive turns in one region: only the turn of this prompt is attributed", () => {
  const text = `${turnRegion(31, 42, "earlier prompt")}${turnRegion(55, 66)}`;
  const turn = kimiTurnUsage(text, { now: at, promptText: PROMPT });
  assert.equal(turn.ended, true);
  assert.deepEqual(
    turn.usages.map((usage) => usage.responseId),
    ["chatcmpl-9JrzyR63gLiHkNIRfo571nSq", "chatcmpl-goGvwOJW56bt6sdZpwgJtjrW"],
  );
  const first = kimiTurnUsage(
    `${turnRegion(31, 42)}${turnRegion(55, 66, "a later prompt")}`,
    { now: at, promptText: PROMPT },
  );
  assert.deepEqual(
    first.usages.map((usage) => usage.responseId),
    ["chatcmpl-9GSbwJc98s8Xy6PnRUDVXHUf", "chatcmpl-Ef9ZC0ooBV5HCOfCfJXXrsEw"],
    "stops at this turn's end",
  );
  assert.deepEqual(first.gaps, []);
});

test("a step or turn end of another turn id inside this turn is a gap and is not attributed", () => {
  const foreign = lines[49]!; // turn 3's step.end with usage
  const text = [
    ...promptRecords(),
    ...lines.slice(32, 37), // turn 2 step 1 (usage)
    foreign,
    ...lines.slice(37, 43),
  ].join("\n");
  const turn = kimiTurnUsage(`${text}\n`, { now: at, promptText: PROMPT });
  assert.equal(turn.ended, true, "final: waiting cannot fix it");
  assert.deepEqual(
    turn.usages.map((usage) => usage.responseId),
    ["chatcmpl-9GSbwJc98s8Xy6PnRUDVXHUf"],
  );
  assert.ok(turn.gaps.some((entry) => entry.reason === "parse_error"));
});

test("unproven regions are gaps, never guesses", () => {
  // No turn end yet.
  const open = kimiTurnUsage(turnRegion(30, 40), { now: at });
  assert.equal(open.ended, false);
  // A turn usage record without its step.end usage.
  const orphan = kimiTurnUsage(
    [
      ...promptRecords(),
      JSON.stringify({
        type: "usage.record",
        usage: { inputOther: 1, output: 1, inputCacheRead: 0 },
        usageScope: "turn",
        time: 1,
      }),
      JSON.stringify({ type: "turn.ended", turnId: 0, time: 2 }),
    ].join("\n"),
    { now: at },
  );
  assert.deepEqual(
    orphan.gaps.map((entry) => entry.reason),
    ["inconsistent_total"],
  );
  assert.deepEqual(orphan.usages, []);
  // A sub-agent call: its steps live in other wires.
  const subAgent = kimiTurnUsage(
    [
      ...promptRecords(),
      JSON.stringify({
        type: "context.append_loop_event",
        event: { type: "tool.call", name: "Agent", args: {} },
        time: 1,
      }),
      JSON.stringify({ type: "turn.ended", turnId: 0, time: 2 }),
    ].join("\n"),
    { now: at },
  );
  assert.deepEqual(
    subAgent.gaps.map((entry) => entry.reason),
    ["unsupported_provider"],
  );
  // The torn tail of a pre-prompt record is skipped, not a gap.
  const torn = kimiTurnUsage(`d":1}\n${turnRegion(30, 42)}`, {
    now: at,
    promptText: PROMPT,
  });
  assert.deepEqual(torn.gaps, []);
  assert.equal(torn.usages.length, 2);
});

test("the wire is found through Kimi's session index and read from the pre-prompt offset, waiting for a late turn end", async () => {
  const home = mkdtempSync(join(tmpdir(), "loom-kimi-wire-"));
  try {
    const sessionDir = join(home, "sessions", "wd_x", "session_a");
    mkdirSync(join(sessionDir, "agents", "main"), { recursive: true });
    writeFileSync(
      join(home, "session_index.jsonl"),
      `${JSON.stringify({ sessionId: "session_a", sessionDir })}\n`,
    );
    const env = { KIMI_CODE_HOME: home };
    const path = kimiMainWirePath("session_a", env)!;
    assert.equal(path, join(sessionDir, "agents", "main", "wire.jsonl"));
    assert.equal(kimiMainWirePath("session_other", env), undefined);
    assert.equal(kimiWireSize(path), 0);
    // History of earlier prompts is before the offset and never counted.
    assert.equal(kimiWireBaseline(path), undefined, "no file: no baseline");
    writeFileSync(path, region(0, 29));
    const baseline = kimiWireBaseline(path)!;
    const offset = kimiWireSize(path);
    assert.equal(baseline.offset, offset);
    const full = turnRegion(30, 42);
    const end = full.lastIndexOf('{"type":"turn.ended"');
    appendFileSync(path, full.slice(0, end));
    setTimeout(() => appendFileSync(path, full.slice(end)), 60);
    const read = await readKimiTurnUsage({
      path,
      offset,
      identity: baseline.identity,
      promptText: PROMPT,
      now: at,
    });
    assert.deepEqual(read.gaps, []);
    assert.deepEqual(
      read.usages.map((usage) => usage.responseId),
      [
        "chatcmpl-9GSbwJc98s8Xy6PnRUDVXHUf",
        "chatcmpl-Ef9ZC0ooBV5HCOfCfJXXrsEw",
      ],
    );
    // A turn end that never comes: the observed usage plus a gap.
    const offset2 = kimiWireSize(path);
    appendFileSync(path, turnRegion(43, 50));
    const unended = await readKimiTurnUsage({
      path,
      offset: offset2,
      promptText: PROMPT,
      timeoutMs: 80,
      now: at,
    });
    assert.deepEqual(
      unended.gaps.map((entry) => entry.reason),
      ["parse_error"],
    );
    assert.equal(unended.usages.length, 1);
    // The wire replaced by another (larger) file after the baseline: its
    // bytes past the offset are not this prompt's.
    const before = kimiWireBaseline(path)!;
    const other = join(home, "restored.jsonl");
    writeFileSync(other, `${region(0, 60)}${turnRegion(30, 42)}`);
    renameSync(other, path);
    const replaced = await readKimiTurnUsage({
      path,
      offset: before.offset,
      identity: before.identity,
      promptText: PROMPT,
      timeoutMs: 80,
      now: at,
    });
    assert.deepEqual(replaced.usages, []);
    assert.deepEqual(
      replaced.gaps.map((entry) => entry.reason),
      ["parse_error"],
    );
    const missing = await readKimiTurnUsage({
      path: join(home, "absent.jsonl"),
      offset: 0,
      now: at,
    });
    assert.deepEqual(missing.usages, []);
    assert.deepEqual(
      missing.gaps.map((entry) => entry.reason),
      ["parse_error"],
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("cancellation before any recorded model request does not invent a usage gap", () => {
  const wire = turnRegion(0, 18)
    .split("\n")
    .filter((line) => {
      if (!line) return true;
      const record = JSON.parse(line);
      return !(record.type === "llm.request" && record.turnStep === "0.3");
    })
    .join("\n");
  const result = kimiTurnUsage(wire, { now: at, promptText: PROMPT });
  assert.equal(result.ended, true);
  assert.equal(result.usages.length, 2);
  assert.deepEqual(result.gaps, []);
});

test("usage from another step cannot cover an issued request missing its own usage", () => {
  const wire = turnRegion(30, 42)
    .split("\n")
    .map((line) => {
      if (!line) return line;
      const record = JSON.parse(line);
      if (record.type === "llm.request") record.turnStep = "2.99";
      return JSON.stringify(record);
    })
    .join("\n");
  const result = kimiTurnUsage(wire, { now: at, promptText: PROMPT });
  assert.equal(result.ended, true);
  assert.equal(result.usages.length, 2);
  assert.deepEqual(
    result.gaps.map((gap) => gap.reason),
    ["parse_error"],
  );
});

test("duplicate response IDs cannot fill a second request coverage gap", () => {
  let firstId: string | undefined;
  const wire = turnRegion(30, 42)
    .split("\n")
    .map((line) => {
      if (!line) return line;
      const record = JSON.parse(line);
      if (record.event?.type === "step.end" && record.event.usage) {
        firstId ??= record.event.messageId;
        record.event.messageId = firstId;
      }
      return JSON.stringify(record);
    })
    .join("\n");
  const result = kimiTurnUsage(wire, { now: at, promptText: PROMPT });
  assert.equal(result.ended, true);
  assert.equal(result.usages.length, 1);
  assert.deepEqual(
    result.gaps.map((gap) => gap.reason),
    ["parse_error"],
  );
});

test("coverage from the following turn cannot erase this turn's cancelled request gap", () => {
  const result = kimiTurnUsage(
    turnRegion(0, 18) + turnRegion(30, 42, "later"),
    { now: at, promptText: PROMPT },
  );
  assert.equal(result.ended, true);
  assert.equal(result.usages.length, 2);
  assert.deepEqual(
    result.gaps.map((gap) => gap.reason),
    ["parse_error"],
  );
});

test("another agent's same-step receipt cannot cover this main agent's request", () => {
  const wire = turnRegion(30, 42)
    .split("\n")
    .map((line) => {
      if (!line) return line;
      const record = JSON.parse(line);
      if (record.event?.type === "step.end") record.agentId = "foreign";
      return JSON.stringify(record);
    })
    .join("\n");
  const result = kimiTurnUsage(wire, { now: at, promptText: PROMPT });
  assert.equal(result.ended, true);
  assert.deepEqual(
    result.gaps.map((gap) => gap.reason),
    ["parse_error"],
  );
});
