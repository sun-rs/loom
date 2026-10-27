/** AGY 1.4.8 stream-json evidence. This parser owns diagnostics, never Room state.
 * Native result is the current invocation's final, not a transcript fallback. */
export class AgyStream {
  constructor({ model, resumeSession }) {
    this.model = model;
    this.expected = resumeSession;
    this.steps = new Map();
  }
  push(frame) {
    if (this.final) throw Error("AGY frame after result");
    if (frame.event === "init") {
      const id = frame.conversation_id;
      if (
        this.session ||
        typeof id !== "string" ||
        !id.trim() ||
        frame.init?.model !== this.model ||
        (this.expected && id !== this.expected)
      )
        throw Error("AGY session/model mismatch");
      this.session = id;
      return { sessionId: id };
    }
    if (!this.session) throw Error("AGY missing init");
    if (frame.event === "step_update") {
      const s = frame.step_update;
      if (
        s?.conversation_id !== this.session ||
        !Number.isSafeInteger(s.step_index) ||
        s.step_index < 0
      )
        throw Error("AGY invalid step identity");
      if (s.step_type === "user_input" && s.state === "DONE") {
        if (this.input !== undefined) throw Error("AGY ambiguous input");
        this.input = s.step_index;
        return { turnId: `${this.session}:${this.input}` };
      }
      if (this.input === undefined || s.step_index <= this.input)
        throw Error("AGY replayed/unscoped step");
      if (s.step_type === "agent_response" && s.state === "DONE") {
        const signature = JSON.stringify(s.usage);
        if (this.steps.has(s.step_index)) {
          if (this.steps.get(s.step_index) !== signature)
            throw Error("AGY conflicting usage");
          return {};
        }
        this.steps.set(s.step_index, signature);
        this.lastAssistant = s.step_index;
        const u = s.usage;
        if (
          !u ||
          !["input_tokens", "output_tokens", "cache_read_tokens"].every(
            (k) => Number.isSafeInteger(u[k]) && u[k] >= 0,
          )
        )
          return { usageGap: true };
        const cacheWrite = u.cache_write_tokens ?? 0;
        if (!Number.isSafeInteger(cacheWrite) || cacheWrite < 0)
          return { usageGap: true };
        return {
          usage: {
            provider: "agy-print-json/v1",
            responseId: `${this.session}:${s.step_index}`,
            inputTokens: u.input_tokens + u.cache_read_tokens + cacheWrite,
            cachedInputTokens: u.cache_read_tokens,
            outputTokens: u.output_tokens,
            reasoningOutputTokens: Number.isSafeInteger(u.thinking_tokens)
              ? u.thinking_tokens
              : null,
            contextWindow: null,
            contextUsedTokens: null,
            observedAt: new Date().toISOString(),
          },
        };
      }
      // Descendant / compaction accounting is not proved by this stream contract.
      if (/subagent|compact/i.test(s.tool_name ?? s.step_type ?? ""))
        return { usageGap: true };
      return {};
    }
    if (frame.event === "result") {
      const r = frame.result;
      if (
        r?.conversation_id !== this.session ||
        r.status !== "SUCCESS" ||
        this.input === undefined ||
        this.lastAssistant === undefined ||
        typeof r.response !== "string" ||
        !r.response.trim()
      )
        throw Error("AGY incomplete final");
      this.final = {
        sessionId: this.session,
        turnId: `${this.session}:${this.input}`,
        nativeMessageId: `${this.session}:${this.lastAssistant}`,
        text: r.response,
      };
      return { final: this.final };
    }
    throw Error("Unknown AGY stream event");
  }
  finish() {
    if (!this.final) throw Error("AGY missing final");
    return this.final;
  }
}
