import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
const stable = (usages: { observedAt: string }[]) =>
  usages.map(({ observedAt: _observedAt, ...rest }) => rest);

test("a completed prompt yields one generation per step.end usage, with the provider message id", () => {
  // Real turn 2: two steps, completed.
  const turn = kimiTurnUsage(region(30, 42), { now: at });
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

test("a prompt ended by the final interrupt keeps its finished steps; the cancelled step has no usage", () => {
  // Real turn 0 (session start lines included): steps 1-2 finished, step 3
  // cancelled before usage.
  const turn = kimiTurnUsage(region(0, 18), { now: at });
  assert.equal(turn.ended, true);
  assert.deepEqual(turn.gaps, []);
  assert.deepEqual(
    turn.usages.map((usage) => [usage.responseId, usage.inputTokens]),
    [
      ["chatcmpl-nZwdJY6YAFnsvaZVPqZvmkbz", 4575 + 19456],
      ["chatcmpl-r0NhQCFpwDbn5seXuFVqydW3", 419 + 23808],
    ],
  );
});

test("a compaction-only prompt yields the compaction's own model call and ends with the compaction", () => {
  const turn = kimiTurnUsage(region(67, 74), { now: at });
  assert.equal(turn.ended, true);
  assert.deepEqual(turn.gaps, []);
  assert.equal(turn.usages.length, 1);
  assert.match(turn.usages[0]!.responseId, /^compaction:/u);
  assert.equal(turn.usages[0]!.inputTokens, 1023 + 26368);
  assert.equal(turn.usages[0]!.cachedInputTokens, 26368);
  assert.equal(turn.usages[0]!.outputTokens, 523);
});

test("unproven regions are gaps, never guesses", () => {
  // No turn end yet.
  const open = kimiTurnUsage(region(30, 40), { now: at });
  assert.equal(open.ended, false);
  // A turn usage record without its step.end usage.
  const orphan = kimiTurnUsage(
    [
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
  const torn = kimiTurnUsage(`d":1}\n${region(30, 42)}`, { now: at });
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
    writeFileSync(path, region(0, 29));
    const offset = kimiWireSize(path);
    appendFileSync(path, region(30, 41));
    setTimeout(() => appendFileSync(path, region(42, 42)), 60);
    const read = await readKimiTurnUsage({ path, offset, now: at });
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
    appendFileSync(path, region(43, 50));
    const unended = await readKimiTurnUsage({
      path,
      offset: offset2,
      timeoutMs: 80,
      now: at,
    });
    assert.deepEqual(
      unended.gaps.map((entry) => entry.reason),
      ["parse_error"],
    );
    assert.equal(unended.usages.length, 1);
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
