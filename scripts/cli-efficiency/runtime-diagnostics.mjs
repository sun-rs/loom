#!/usr/bin/env node
// Read-only diagnostic observations, not a runtime policy or cost estimator.
import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { CodexTokenUsageTracker } from "../../packages/agent-host/src/provider-usage.js";

const positive = (n) => Number.isSafeInteger(n) && n > 0;
const id = (s) => typeof s === "string" && s.length > 0;
const pairKey = (...parts) => JSON.stringify(parts);
const MAX_OBSERVATIONS = 10000;

export class RuntimeDiagnostics {
  #turns = new Map();
  #trackers = new Map();
  #seen = new Set();
  #lastRetry = new Map();
  #piSession = null;
  #piPending = null;
  #line = 0;
  #frames = 0;
  #recognized = 0;
  #compactions = [];
  #retries = [];
  #closed = false;

  #push(list, row) {
    assert.ok(
      list.length < MAX_OBSERVATIONS,
      "Diagnostic observation limit exceeded",
    );
    list.push(row);
  }
  #unknown(state, reason) {
    if (state.pending) {
      this.#push(this.#compactions, {
        ...state.pending,
        post: null,
        classification: "unknown",
        reason,
      });
      state.pending = null;
    }
    state.last = null;
  }
  observe(frame, line = this.#line + 1) {
    assert.ok(!this.#closed, "Report already finished");
    assert.ok(
      frame && typeof frame === "object" && !Array.isArray(frame),
      "Expected JSON object frame",
    );
    assert.ok(
      Number.isSafeInteger(line) && line > this.#line,
      "Source lines must increase",
    );
    this.#line = line;
    this.#frames++;
    const session = frame.properties?.sessionID;
    if (
      id(session) &&
      (frame.type === "session.idle" ||
        (frame.type === "session.status" &&
          frame.properties.status?.type !== "retry"))
    ) {
      this.#lastRetry.delete(session);
    }
    const p = frame.params ?? {};
    if (
      [
        "thread/tokenUsage/updated",
        "item/completed",
        "turn/completed",
      ].includes(frame.method)
    ) {
      const turn = p.turnId ?? p.turn?.id;
      if (!id(p.threadId) || !id(turn)) return;
      this.#recognized++;
      const key = pairKey(p.threadId, turn);
      if (!this.#turns.has(key)) {
        assert.ok(this.#turns.size < MAX_OBSERVATIONS, "Turn limit exceeded");
        this.#turns.set(key, { last: null, pending: null, zeros: 0 });
      }
      const state = this.#turns.get(key);
      if (frame.method === "turn/completed") {
        this.#unknown(state, "turn-ended-before-post");
        return;
      }
      if (frame.method === "item/completed") {
        if (p.item?.type !== "contextCompaction") {
          // Any completed item may add context. Do not silently compare across it.
          this.#unknown(state, "intervening-item");
          return;
        }
        if (!id(p.item.id)) {
          this.#unknown(state, "missing-compaction-identity");
          return;
        }
        const eventKey = pairKey("codex", p.threadId, turn, p.item.id);
        if (this.#seen.has(eventKey)) return;
        this.#seen.add(eventKey);
        const pre = state.last;
        if (state.pending) this.#unknown(state, "overlapping-compaction");
        state.pending = {
          provider: "codex",
          sessionId: p.threadId,
          turnId: turn,
          id: p.item.id,
          line: this.#line,
          pre: state.last === null ? null : pre,
          measurement: "observed-request-input-before-and-after-boundary",
        };
        state.zeros = 0;
        return;
      }
      const input = p.tokenUsage?.last?.inputTokens;
      if (input === 0) {
        if (state.pending && ++state.zeros > 5)
          this.#unknown(state, "zero-marker-limit");
        else if (!state.pending) state.last = null;
        return;
      }
      if (!this.#trackers.has(p.threadId))
        this.#trackers.set(
          p.threadId,
          new CodexTokenUsageTracker({ freshThread: false, now: () => 0 }),
        );
      const fact = this.#trackers.get(p.threadId).observe(frame);
      if (!fact) return; // Exact duplicate notification, per existing provider parser.
      if (!positive(fact.inputTokens)) {
        this.#unknown(state, "usage-gap-or-invalid-input");
        return;
      }
      if (state.pending) {
        const pending = state.pending;
        this.#push(this.#compactions, {
          ...pending,
          post: fact.inputTokens,
          postLine: this.#line,
          ratio: positive(pending.pre) ? fact.inputTokens / pending.pre : null,
          classification: !positive(pending.pre)
            ? "unknown"
            : fact.inputTokens < pending.pre
              ? "observed-reduction"
              : "no-observed-reduction",
          reason: positive(pending.pre) ? null : "missing-pre",
        });
        state.pending = null;
      }
      state.last = fact.inputTokens;
      return;
    }
    if (frame.type === "session" && id(frame.id)) {
      this.#recognized++;
      if (this.#piPending) this.#finishPi(null, "session-boundary");
      this.#piSession = frame.id;
    } else if (frame.type === "compaction_start") {
      this.#recognized++;
      if (this.#piPending) this.#finishPi(null, "overlapping-compaction");
      this.#piPending = { line: this.#line, sessionId: this.#piSession };
    } else if (frame.type === "compaction_end") {
      this.#recognized++;
      this.#finishPi(
        frame,
        this.#piPending && this.#piSession
          ? "estimated-or-missing-post"
          : "missing-start-or-session",
      );
      if (frame.willRetry === true)
        this.#push(this.#retries, {
          provider: "pi",
          sessionId: this.#piSession,
          line: this.#line,
          kind: "retry-intent",
        });
    } else if (frame.type === "agent_end" && this.#piPending) {
      this.#recognized++;
      this.#finishPi(null, "agent-ended-before-completion");
    } else if (
      frame.type === "session.status" &&
      frame.properties?.status?.type === "retry"
    ) {
      this.#recognized++;
      const { sessionID, status } = frame.properties;
      if (!id(sessionID)) return;
      const attempt = positive(status.attempt) ? status.attempt : null;
      // attempt absent => an observation only, never an invented execution count.
      const key = pairKey(
        "opencode",
        sessionID,
        attempt,
        attempt === null ? this.#line : null,
      );
      if (this.#lastRetry.get(sessionID) === key) return;
      assert.ok(
        this.#lastRetry.has(sessionID) ||
          this.#lastRetry.size < MAX_OBSERVATIONS,
        "Retry session limit exceeded",
      );
      this.#lastRetry.set(sessionID, key);
      this.#push(this.#retries, {
        provider: "opencode",
        sessionId: sessionID,
        line: this.#line,
        attempt,
        kind: "provider-retry-status",
      });
    }
  }
  #finishPi(frame, reason) {
    const result = frame?.result;
    this.#push(this.#compactions, {
      provider: "pi",
      sessionId: this.#piPending?.sessionId ?? this.#piSession,
      line: this.#piPending?.line ?? this.#line,
      pre: positive(result?.tokensBefore) ? result.tokensBefore : null,
      post: null,
      estimatedPost: positive(result?.estimatedTokensAfter)
        ? result.estimatedTokensAfter
        : null,
      aborted: frame?.aborted ?? null,
      measurement: "native-pre-and-optional-estimated-post",
      classification: "unknown",
      reason,
    });
    this.#piPending = null;
  }
  finish() {
    assert.ok(!this.#closed, "Report already finished");
    for (const state of this.#turns.values())
      this.#unknown(state, "end-of-file-before-post");
    if (this.#piPending) this.#finishPi(null, "end-of-file-before-completion");
    this.#closed = true;
    return {
      kind: "loom-offline-runtime-diagnostics/v1",
      frames: this.#frames,
      recognizedFrames: this.#recognized,
      coverage: "partial-or-unknown",
      compactions: this.#compactions,
      retryObservations: this.#retries,
      retryWasteVerdict: "unknown",
      wastedTokens: null,
      interpretation:
        "Observations only. A non-decreasing prompt pair is not proof of wasted work or a compression storm. Retry signals do not establish executed requests, necessity or cost. No automatic interruption, session replacement or billing estimate.",
    };
  }
}

export async function inspectRuntimeFile(path) {
  const stream = createReadStream(path);
  const hash = createHash("sha256");
  let size = 0;
  stream.on("data", (chunk) => {
    size += chunk.length;
    hash.update(chunk);
    if (size > 128 * 1024 * 1024)
      stream.destroy(new Error("Input exceeds 128 MiB offline limit"));
  });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const diagnostic = new RuntimeDiagnostics();
  let line = 0;
  try {
    for await (const raw of lines) {
      line++;
      if (!raw.trim()) continue;
      assert.ok(
        Buffer.byteLength(raw) <= 2 * 1024 * 1024,
        `Oversized JSON frame at line ${line}`,
      );
      let frame;
      try {
        frame = JSON.parse(raw);
      } catch {
        throw new Error(
          `Invalid JSON at line ${line}; refusing partial diagnosis`,
        );
      }
      diagnostic.observe(frame, line);
    }
    return {
      ...diagnostic.finish(),
      source: { path, sha256: hash.digest("hex"), bytes: size },
    };
  } finally {
    lines.close();
    stream.destroy();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    assert.equal(
      process.argv.length,
      3,
      "Usage: node scripts/cli-efficiency/runtime-diagnostics.mjs <raw.jsonl>",
    );
    console.log(
      JSON.stringify(await inspectRuntimeFile(process.argv[2]), null, 2),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
