// Base parser from /Users/sun/Code/exp-relay/orca/lib/claude.mjs (loom-transcript).
import { isClaudeToolResultContent, isClaudeToolUseContent, toolExitCode } from './tool-evidence.mjs';

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function stringOrNull(value) {
  return typeof value === 'string' ? value : null;
}

function emptyUsage() {
  return {
    calls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
}

function addUsage(total, usage, callCount) {
  total.calls += callCount;
  total.inputTokens += usage.inputTokens;
  total.cachedInputTokens += usage.cachedInputTokens;
  total.cacheWriteInputTokens += usage.cacheWriteInputTokens;
  total.outputTokens += usage.outputTokens;
  total.reasoningOutputTokens += usage.reasoningOutputTokens;
}

function readCall(usage, id, timestamp) {
  const counts = [
    usage?.input_tokens,
    usage?.cache_read_input_tokens,
    usage?.cache_creation_input_tokens,
    usage?.output_tokens,
    usage?.output_tokens_details?.thinking_tokens,
  ];
  if (!counts.some(isCount)) return null;

  const [freshInput, cachedInputTokens, cacheWriteInputTokens, outputTokens, reasoningOutputTokens] =
    counts.map((value) => (isCount(value) ? value + 0 : 0));
  return {
    id,
    timestamp,
    inputTokens: freshInput + cachedInputTokens + cacheWriteInputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    outputTokens,
    reasoningOutputTokens,
  };
}

function contentBlocks(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content : [];
}

function isTextBlock(block) {
  return block?.type === 'text' && typeof block.text === 'string';
}

// Assistant rows used for Stop fallback, from the former drivers/claude-tui/src/transcript.ts.
export function parseTranscriptRow(row) {
  const items = [];
  if (row.type === 'assistant' || (row.message?.role ?? row.role) === 'assistant') {
    for (const block of contentBlocks(row.message?.content ?? row.content)) {
      if (isTextBlock(block)) items.push({ kind: 'assistant_text', text: block.text });
      if (block?.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
        items.push({ kind: 'tool_use' });
      }
    }
  }
  if (row.type === 'result' && typeof row.result === 'string') {
    items.push({ kind: 'assistant_text', text: row.result });
  }
  return items;
}

function readUserText(blocks) {
  const localCommandTag = /^<(?:local-command-(?:caveat|stdout|stderr)|command-(?:name|message|args))(?=[\s/>])/;
  return blocks.filter(isTextBlock).map((block) => block.text.trim())
    .filter((text) => text && !localCommandTag.test(text)).join('\n');
}

// Orca b7fd7caa3: src/main/native-chat/transcript-decoding/transcript-line-decoders-claude.ts
// claudeQueuedPromptAsUserRecord: a human prompt attached mid-turn belongs to the active turn.
function readQueuedPrompt(record) {
  const attachment = record.attachment;
  if (attachment?.type !== 'queued_command' || attachment.commandMode !== 'prompt') return '';
  const originKind = attachment.origin?.kind;
  if (originKind !== undefined && originKind !== 'human') return '';
  return readUserText(contentBlocks(attachment.prompt));
}

function appendBlocks(group, blocks, index, timestamp, lineNumber) {
  for (const [offset, block] of blocks.entries()) {
    const entry = { block, timestamp, lineNumber };
    if (isCount(index)) {
      group.indexedBlocks.set(index + offset, entry);
    } else {
      group.unindexedBlocks.push(entry);
    }
  }
}

function blockEntries(group) {
  const indexedBlocks = [...group.indexedBlocks.keys()].sort((a, b) => a - b);
  return [
    ...indexedBlocks.map((index) => group.indexedBlocks.get(index)),
    ...group.unindexedBlocks,
  ];
}

function finalReply(group) {
  if (!group || group.stoppedForTool) return null;
  if (group.stopReason != null && !['end_turn', 'stop_sequence', 'max_tokens'].includes(group.stopReason)) {
    return null;
  }

  const entries = blockEntries(group);
  if (entries.some(({ block }) => isClaudeToolUseContent(block))) return null;

  const textBlocks = entries.filter(({ block }) => isTextBlock(block));
  const text = textBlocks.map(({ block }) => block.text).join('\n');
  if (text.trim() === '') return null;

  const latest = textBlocks.reduce((last, entry) => (entry.lineNumber > last.lineNumber ? entry : last));
  return { text, timestamp: latest.timestamp };
}

function collectTools(groups, results) {
  const tools = [];
  const seen = new Set();
  for (const group of groups) {
    for (const { block } of blockEntries(group)) {
      if (!isClaudeToolUseContent(block)) continue;
      const id = stringOrNull(block.id);
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      tools.push({
        id,
        name: stringOrNull(block.name),
        command: stringOrNull(block.input?.command),
        exitCode: results.get(id) ?? null,
      });
    }
  }
  return tools;
}

export function parseClaude(text) {
  const session = { provider: 'claude', turns: [], lastReply: null, usage: emptyUsage() };
  const seenCallIds = new Set();
  let activeTurn = null;

  function finishTurn(status, timestamp) {
    if (!activeTurn) return;

    const groups = [...activeTurn.groups.values()];
    const reply = status === 'interrupted' ? null : finalReply(groups.at(-1));
    const usage = emptyUsage();
    const calls = [];
    for (const { call } of groups) {
      if (!call) continue;
      calls.push(call);
      addUsage(usage, call, 1);
    }

    session.turns.push({
      index: session.turns.length + 1,
      id: activeTurn.id,
      startedAt: activeTurn.startedAt,
      endedAt: timestamp ?? reply?.timestamp ?? null,
      status: status ?? (reply ? 'completed' : 'incomplete'),
      reply: reply?.text ?? null,
      usage,
      calls,
      prompts: activeTurn.prompts,
      tools: collectTools(groups, activeTurn.toolResults),
    });
    if (reply) session.lastReply = reply.text;
    addUsage(session.usage, usage, usage.calls);
    activeTurn = null;
  }

  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const [lineNumber, line] of lines.entries()) {
    if (line.trim() === '') continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    if (record.isSidechain === true || record.parent_tool_use_id != null || record.parentToolUseId != null) {
      continue;
    }
    if (record.isMeta || record.isCompactSummary || record.isVisibleInTranscriptOnly) continue;

    const { type, subtype, message } = record;
    const timestamp = stringOrNull(record.timestamp);
    const blocks = contentBlocks(message?.content ?? record.content);
    const prompt = type === 'user' ? readUserText(blocks) : '';
    if (activeTurn && type === 'user') {
      const results = blocks.filter(isClaudeToolResultContent);
      const metadata = results.length === 1 ? (record.toolUseResult ?? record.tool_use_result) : null;
      for (const result of results) {
        const code = toolExitCode(result, metadata);
        if (result.tool_use_id && code !== null) activeTurn.toolResults.set(result.tool_use_id, code);
      }
    }
    const interrupted = record.interruptedMessageId != null || type === 'turn_aborted'
      || (type === 'system' && subtype === 'turn_aborted')
      || ((type === 'user' || type === 'system') && blocks.some((block) =>
        isTextBlock(block) && block.text.startsWith('[Request interrupted by user')));
    if (interrupted) {
      finishTurn('interrupted', timestamp);
    } else if (type === 'compact_boundary' || (type === 'system' && subtype === 'compact_boundary')) {
      finishTurn(null, timestamp);
    } else if (type === 'system' && subtype === 'turn_duration') {
      finishTurn('completed', timestamp);
    } else if (prompt) {
      finishTurn();
      activeTurn = { id: stringOrNull(record.uuid), startedAt: timestamp, groups: new Map(),
        prompts: [prompt], toolResults: new Map() };
    } else if (activeTurn && type === 'attachment') {
      const queued = readQueuedPrompt(record);
      if (queued) activeTurn.prompts.push(queued);
    } else if (type === 'assistant' && activeTurn && message && typeof message === 'object' && !Array.isArray(message)) {
      const id = stringOrNull(message.id) ?? stringOrNull(record.requestId) ?? stringOrNull(record.uuid);
      const key = id ?? Symbol();
      let group = activeTurn.groups.get(key);
      if (!group) {
        if (seenCallIds.has(id)) continue;
        if (id !== null) seenCallIds.add(id);
        group = {
          indexedBlocks: new Map(),
          unindexedBlocks: [],
          stopReason: null,
          stoppedForTool: false,
          call: null,
        };
        activeTurn.groups.set(key, group);
      }

      appendBlocks(group, blocks, record.apiBlockIndex, timestamp, lineNumber);
      const stopReason = message.stop_reason;
      if (stopReason != null) group.stopReason = stopReason;
      group.stoppedForTool ||= stopReason === 'tool_use' || stopReason === 'pause_turn';
      group.call = readCall(message.usage, id, timestamp) ?? group.call;
    }
  }

  finishTurn();
  return session;
}
