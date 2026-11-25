import { createHash } from 'node:crypto';
import claude from '../../adapters/claude/index.mjs';
import { stopFailure } from './failure.mjs';

function blocks(content) {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
}

function textOf(content) {
  return blocks(content).filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text).join('\n');
}

function outputOf(content) {
  if (content === undefined) return undefined;
  return blocks(typeof content === 'string' || Array.isArray(content) ? content : [content]).map((block) => {
    if (block?.type === 'text' && typeof block.text === 'string') return { type: 'text', text: block.text };
    if (block?.type === 'image' && block.source?.type === 'base64') {
      return { type: 'image', mediaType: block.source.media_type, data: block.source.data };
    }
    return { type: 'other', value: block };
  });
}

function interruption(row, content) {
  return row.interruptedMessageId != null ||
    row.type === 'turn_aborted' || (row.type === 'system' && row.subtype === 'turn_aborted') ||
    ((row.type === 'user' || row.type === 'system') && /^\[Request interrupted by user(?: for tool use)?\]/.test(textOf(content)));
}

function transcriptType(row) {
  if (['user', 'assistant', 'turn_aborted', 'queue-operation'].includes(row.type)) return row.type;
  if (row.type === 'system' && ['turn_duration', 'turn_aborted'].includes(row.subtype)) {
    return `system/${row.subtype}`;
  }
  if (row.type === 'attachment' && row.attachment?.type === 'queued_command') return 'attachment/queued_command';
  return null;
}

function normalized(input) {
  return typeof input === 'string' ? input.replace(/\r\n/g, '\n').trim() : null;
}

export class TranscriptProjection {
  #records = new Set();
  #blocks = new Set();
  #toolsStarted = new Set();
  #toolsEnded = new Set();
  #model;

  modelEvent(model) {
    if (typeof model !== 'string' || !model || model === '<synthetic>' || model === this.#model) return [];
    this.#model = model;
    return [{ kind: 'model', model }];
  }

  read(row, sessionId) {
    const type = transcriptType(row);
    if (!type || (row.sessionId && row.sessionId !== sessionId) ||
        row.isSidechain || row.parent_tool_use_id != null || row.parentToolUseId != null) return null;
    const { uuid, message } = row;
    if (uuid && this.#records.has(uuid)) return null;
    if (uuid) this.#records.add(uuid);
    const content = message?.content ?? row.content;
    const events = [];
    let input;
    if (interruption(row, content)) return { type, events, aborted: true };
    if (type === 'system/turn_duration') return { type, events, completed: true };
    if (row.isMeta || row.isCompactSummary || row.isVisibleInTranscriptOnly) return null;
    if (type === 'assistant' && !row.isApiErrorMessage) {
      events.push(...this.modelEvent(message?.model));
      const messageId = message?.id ?? uuid;
      for (const [index, block] of blocks(content).entries()) {
        if (!block) continue;
        if (messageId) {
          const key = createHash('sha256').update(JSON.stringify([messageId, row.apiBlockIndex ?? index, block])).digest('hex');
          if (this.#blocks.has(key)) continue;
          this.#blocks.add(key);
        }
        if (block.type === 'text' && typeof block.text === 'string' && block.text) {
          events.push({ kind: 'text_delta', text: block.text, ...(messageId ? { messageId } : {}) });
        } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
          const reasoning = block.type === 'redacted_thinking' ? { kind: 'redacted' }
            : block.thinking ? { kind: 'text', text: block.thinking } : { kind: 'empty' };
          events.push({ kind: 'reasoning', content: reasoning, ...(messageId ? { messageId } : {}) });
        } else if (block.type === 'tool_use' && block.id && block.name && !this.#toolsStarted.has(block.id)) {
          this.#toolsStarted.add(block.id);
          const args = JSON.stringify(block.input);
          events.push({ kind: 'tool_call_started', callId: block.id, tool: block.name });
          if (args !== undefined) events.push({ kind: 'tool_call_input', callId: block.id, input: args });
        }
      }
    }
    if (type === 'user') {
      let toolResult = false;
      for (const block of blocks(content)) {
        const callId = block?.tool_use_id;
        if (block?.type !== 'tool_result') continue;
        toolResult = true;
        if (!callId || this.#toolsEnded.has(callId)) continue;
        this.#toolsEnded.add(callId);
        const output = outputOf(block.content);
        events.push({
          kind: 'tool_call_ended',
          callId,
          ...(output === undefined ? {} : { content: output }),
          ...(typeof block.is_error === 'boolean' ? { result: block.is_error ? 'failed' : 'ok' } : {}),
        });
      }
      if (!toolResult) input = textOf(content) || undefined;
    }
    if (type === 'attachment/queued_command' && row.attachment.humanTurn !== false) {
      input = textOf(row.attachment.prompt) || undefined;
    }
    return { type, events, input };
  }
}

export class TurnTracker {
  #kernel;
  #projection = new TranscriptProjection();
  #turn = null;
  #waiting = [];
  #results = [];
  #screen;
  #compacting = false;
  #usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  constructor(kernel) {
    this.#kernel = kernel;
  }

  get active() { return this.#turn !== null; }
  get compacting() { return this.#compacting; }
  get inputUncertain() { return this.#waiting.some(entry => !entry.confirmed); }
  get nativeQueue() { return this.#waiting.some((entry) => entry.queued); }

  resultAfter(seq, inputId) {
    const matches = (turn) => inputId === undefined || turn.inputIds.includes(inputId);
    return (seq === undefined
      ? this.#results.findLast(matches)
      : this.#results.find((turn) => turn.seq > seq && matches(turn))) ?? null;
  }

  #newTurn() {
    return {
      promptId: undefined,
      inputs: new Set(),
      pending: null,
      started: false,
      rows: [],
      failureKey: this.#screen?.failureKey ?? null,
      interruption: this.#screen?.interruption ?? 0,
      abortSent: false,
      outcome: null,
      abortScreenSeen: false,
      failure: null,
      failureScreenSeen: null,
    };
  }

  sent(request, inputId) {
    const { kind, input } = request.body;
    const entry = { kind, input, inputId, requestId: request.id, queued: false };
    this.#waiting.push(entry);
    if (kind === 'prompt') {
      this.#turn = this.#newTurn();
      this.#turn.pending = entry;
    }
    return entry;
  }

  refused(entry) {
    if (this.#turn?.pending === entry && !this.#turn.started) this.#turn = null;
    this.#remove(entry);
  }

  interruptSent() {
    if (!this.#turn || this.#turn.abortSent) return null;
    this.#turn.abortSent = true;
    return this.#turn;
  }

  #match(text, kind) {
    const input = normalized(text);
    if (!input) return null;
    return this.#waiting.find((entry) =>
      (!kind || kind === entry.kind) && normalized(entry.input) === input) ?? null;
  }

  #remove(entry) {
    const index = this.#waiting.indexOf(entry);
    if (index >= 0) this.#waiting.splice(index, 1);
  }

  #frame(type, native, events, receivedAt, spanId = this.#turn?.promptId) {
    return this.#kernel.frame({ type, native, events }, { receivedAt, spanId });
  }

  #activate(events, promptId, entry = null) {
    this.#turn ??= this.#newTurn();
    const turn = this.#turn;
    turn.promptId ??= promptId;
    const queuedDelivery = entry?.queued && !turn.inputs.has(entry.inputId);
    if (entry?.inputId) turn.inputs.add(entry.inputId);
    if (!turn.started || queuedDelivery) {
      events.push({ kind: 'turn_active', ...(entry?.inputId ? { inputId: entry.inputId } : {}) });
    }
    turn.started = true;
  }

  #finish(type, row, events, outcome, receivedAt, finalReply = null) {
    const turn = this.#turn;
    if (!turn) return this.#frame(type, row, events, receivedAt);
    const transcript = claude.transcript.parse(turn.rows.join('\n')).turns.at(-1);
    if (outcome.kind === 'completed') {
      finalReply ??= transcript?.reply ?? null;
      if (finalReply && !transcript?.reply) events.push({ kind: 'text_delta', text: finalReply });
    }
    if (transcript?.usage.calls) {
      const usage = transcript.usage;
      this.#usage.input += usage.inputTokens + usage.cachedInputTokens + usage.cacheWriteInputTokens;
      this.#usage.output += usage.outputTokens;
      this.#usage.cacheRead += usage.cachedInputTokens;
      this.#usage.cacheWrite += usage.cacheWriteInputTokens;
      events.push({ kind: 'usage', usage: { tokens: { ...this.#usage } } });
    }
    const inputIds = [...turn.inputs];
    events.push({ kind: 'turn_ended', outcome, ...(inputIds.length ? { inputId: inputIds[0], inputIds } : {}) });
    turn.outcome = outcome;
    this.#remove(turn.pending);
    this.#turn = null;
    const { seq } = this.#frame(type, row, events, receivedAt, turn.promptId);
    this.#results.push(Object.freeze({ seq, outcome, finalReply, inputIds: Object.freeze(inputIds) }));
  }

  hook(row, screen) {
    const normalizedHook = claude.hooks.normalize(row);
    const name = row.hook_event_name;
    const type = `hook/${name}`;
    const receivedAt = row.receivedAt;
    const events = [];
    if (name === 'SessionStart') {
      return this.#frame(type, row, this.#projection.modelEvent(row.model), receivedAt);
    }
    if (name === 'PreCompact') this.#compacting = true;
    if (name === 'PostCompact' || name === 'SessionEnd') this.#compacting = false;
    if (normalizedHook?.type === 'turn-start') {
      const entry = this.#match(row.prompt);
      if (entry) entry.confirmed = 'hook';
      if (!this.#turn?.started) this.#activate(events, row.prompt_id, entry);
    } else if (this.#turn && (!row.prompt_id || !this.#turn.promptId || row.prompt_id === this.#turn.promptId)) {
      if (normalizedHook?.type === 'turn-end') {
        const outcome = row.is_interrupt === true ? { kind: 'aborted' } : { kind: 'completed' };
        return this.#finish(type, row, events, outcome, receivedAt, normalizedHook.finalReply);
      }
      if (normalizedHook?.type === 'stop-failure') {
        const screenFailure = screen.failureKey && screen.failureKey !== this.#turn.failureKey ? screen.failure : null;
        const transcriptFailure = this.#turn.failure;
        const evidence = transcriptFailure?.failure === 'quota' ? transcriptFailure : screenFailure ?? transcriptFailure;
        const outcome = stopFailure(row, evidence);
        return this.#finish(type, row, events, outcome, receivedAt);
      }
    }
    this.#frame(type, row, events, receivedAt, row.prompt_id);
  }

  transcript(row, receivedAt) {
    const data = this.#projection.read(row, this.#kernel.sessionId);
    if (!data) return;
    const { type, events, input } = data;
    if (type === 'queue-operation' && row.operation === 'enqueue') {
      const entry = this.#match(row.content, 'steer');
      if (entry) entry.confirmed = 'transcript';
      if (entry?.inputId && !entry.queued) {
        entry.queued = true;
        events.push({ kind: 'input_queued', inputId: entry.inputId });
      }
    }
    if (input !== undefined) {
      const entry = this.#match(input, type === 'attachment/queued_command' ? 'steer' : undefined);
      if (entry) entry.confirmed = 'transcript';
      this.#activate(events, row.turnPromptId ?? row.promptId, entry);
      if (entry) this.#remove(entry);
      const nativeMessageId = type === 'attachment/queued_command' ? row.attachment.source_uuid : row.uuid;
      events.push({
        kind: 'user_message', input, evidence: type === 'user' ? 'turn_item' : 'conversation',
        ...(entry?.inputId ? { inputId: entry.inputId } : {}),
        ...(nativeMessageId ? { nativeMessageId } : {}),
      });
    }
    if (this.#turn && type !== 'queue-operation') this.#turn.rows.push(JSON.stringify(row));
    if (row.isApiErrorMessage && this.#turn) {
      this.#turn.failure = stopFailure({ error: row.apiError ?? row.error, error_details: textOf(row.message?.content) });
    }
    if (data.aborted) return this.#finish(type, row, events, { kind: 'aborted' }, receivedAt);
    if (data.completed && this.#turn?.started) {
      return this.#finish(type, row, events, this.#turn.failure ?? { kind: 'completed' }, receivedAt);
    }
    this.#frame(type, row, events, receivedAt);
  }

  screen(evidence, receivedAt) {
    this.#screen = evidence;
    const turn = this.#turn;
    if (!turn) return;
    const interrupted = turn.abortSent && evidence.ready && evidence.interruption > turn.interruption;
    if (interrupted && turn.abortScreenSeen) {
      return this.#finish('screen/interrupted', { text: evidence.text }, [], { kind: 'aborted' }, receivedAt);
    }
    turn.abortScreenSeen = interrupted;
    // Give the structured StopFailure a poll to arrive. Ignore diagnostics
    // that were already visible at the start of this turn or during a retry.
    const failure = !evidence.busy && evidence.failureKey !== turn.failureKey ? evidence.failure : null;
    if (failure && evidence.failureKey === turn.failureScreenSeen) {
      const outcome = turn.failure?.failure === 'quota' ? turn.failure : failure;
      return this.#finish('screen/failure', { diagnostic: failure.reason }, [], outcome, receivedAt);
    }
    turn.failureScreenSeen = failure ? evidence.failureKey : null;
  }

  dropped(entry, reason, message) {
    this.#frame('adapter/input_dropped', null, [{
      kind: 'input_dropped', requestId: entry.requestId, inputId: entry.inputId, reason,
      ...(message ? { message } : {}),
    }], Date.now());
  }
}
