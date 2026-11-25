import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseAgy } from './lib/parse-agy.mjs';

// Orca b7fd7caa3: src/main/antigravity/antigravity-transcript-import.ts:13-17,54-61.
const AGY_CONVERSATION_FOLDER = 'antigravity-cli';
const FULL_TRANSCRIPT = 'transcript_full.jsonl';
const COMPACT_TRANSCRIPT = 'transcript.jsonl';
const CONVERSATION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;

function candidates(sessionId, cwd) {
  if (typeof sessionId !== 'string' || !CONVERSATION_ID.test(sessionId)) return [];
  const homes = new Set(cwd ? [resolve(cwd), homedir()] : [homedir()]);
  return [...homes].map(home => {
    const logs = join(home, '.gemini', AGY_CONVERSATION_FOLDER, 'brain', sessionId, '.system_generated', 'logs');
    return [join(logs, FULL_TRANSCRIPT), join(logs, COMPACT_TRANSCRIPT)];
  });
}

function isFile(path) {
  try {
    return realpathSync(path) === path && statSync(path).isFile();
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP'].includes(error.code)) return false;
    throw error;
  }
}

export function locate({ sessionId, cwd }) {
  return candidates(sessionId, cwd).flat().find(isFile) ?? null;
}

export function locateHookTranscript({ sessionId, cwd, transcriptPath }) {
  // Match the path advertised by this hook and only consider the native sibling files.
  const pair = candidates(sessionId, cwd).find(paths => paths.includes(transcriptPath));
  return pair?.find(isFile) ?? null;
}

// Orca b7fd7caa3: src/shared/agent-hook-listener/transcript-lines.ts:8-17.
function extractAntigravityUserRequest(content) {
  const opener = '<USER_REQUEST>';
  const startIndex = content.indexOf(opener);
  const bodyStartIndex = startIndex === -1 ? -1 : startIndex + opener.length;
  const endIndex = bodyStartIndex === -1 ? -1 : content.indexOf('</USER_REQUEST>', bodyStartIndex);
  const text =
    bodyStartIndex === -1 || endIndex === -1 ? content : content.slice(bodyStartIndex, endIndex);
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// Conversation rows as decoded by the former drivers/tui-hooks/agy/src/index.ts.
export function parseAgyTranscriptLine(row) {
  if (!row || typeof row.content !== 'string') return [];
  const source = String(row.source ?? '');
  const type = String(row.type ?? '');
  if (source === 'MODEL' && type === 'PLANNER_RESPONSE' && row.content.trim()) {
    return [{ kind: 'assistant', text: row.content, raw: row }];
  }
  if ((source === 'USER_EXPLICIT' || source === 'USER') && (type === 'USER_INPUT' || type === 'REQUEST')) {
    const opening = '<USER_REQUEST>';
    const start = row.content.indexOf(opening);
    const body = start < 0 ? row.content : row.content.slice(start + opening.length);
    const end = body.indexOf('</USER_REQUEST>');
    const text = (end < 0 ? body : body.slice(0, end)).trim();
    if (text) return [{ kind: 'user', text, raw: row }];
  }
  return [];
}

// Keep the loom-transcript v1 JSON shape. L1 details are derived from the same deduplicated steps.
const turnDetails = new WeakMap();
const toolStep = /^(?:RUN_COMMAND|TOOL_(?:CALL|USE|RESULT)|FUNCTION_(?:CALL|RESULT))$/;

function commandLine(tool) {
  const command = tool?.command ?? tool?.cmd ?? tool?.args?.CommandLine ?? tool?.args?.command ?? tool?.args?.cmd;
  return typeof command === 'string' && command.trim() ? command : undefined;
}

function exitCode(tool) {
  const code = tool?.exit_code ?? tool?.exitCode ?? tool?.result?.exit_code ?? tool?.result?.exitCode;
  if (Number.isSafeInteger(code)) return code;
  if (typeof code === 'string' && /^-?\d+$/.test(code) && Number.isSafeInteger(Number(code))) return Number(code);
}

function toolName(tool) {
  if (typeof tool?.name === 'string') return tool.name;
  return typeof tool?.tool_name === 'string' ? tool.tool_name : undefined;
}

function observeToolStep(detail, row) {
  const calls = row.tool_calls ?? row.toolCalls;
  if (Array.isArray(calls) && calls.length) {
    detail.count += calls.length;
    for (const call of calls) {
      const name = toolName(call);
      const command = commandLine(call);
      const code = exitCode(call);
      if (name) detail.tools.add(name);
      if (code !== undefined && code !== 0) detail.failures.push({ command, code });
      if (code === undefined && (command || name)) detail.pending.push({ command, name });
    }
    return;
  }

  const tool = row.toolCall ?? row.tool_call ?? row;
  const code = exitCode(tool);
  if (tool !== row || toolStep.test(row.type) || code !== undefined) {
    const command = commandLine(tool);
    const name = toolName(tool) ?? (row.type === 'RUN_COMMAND' ? 'run_command' : undefined);
    if (name) detail.tools.add(name);
    const index = detail.pending.findIndex(call => command ? call.command === command : name && call.name === name);
    const matched = index < 0 ? undefined : detail.pending.splice(index, 1)[0];
    if (!matched) detail.count += 1;
    if (code !== undefined && code !== 0) detail.failures.push({ command: command ?? matched?.command, code });
  } else if (row.source === 'MODEL' && row.type === 'GENERIC' && typeof row.content === 'string') {
    const commands = detail.pending.filter(call => call.command);
    if (commands.length !== 1) return;
    // Only match the runtime's command result header. The command can write anything below it.
    const header = row.content.split(/\r?\nCommand output:/i, 1)[0];
    const result = /^Command exited with code (-?\d+)\./m.exec(header);
    if (!result) return;
    const exit = Number(result[1]);
    if (!Number.isSafeInteger(exit)) return;
    const [call] = commands;
    detail.pending.splice(detail.pending.indexOf(call), 1);
    if (exit !== 0) detail.failures.push({ command: call.command, code: exit });
  }
}

export function parse(text) {
  const details = [];
  const session = parseAgy(text, (index, row) => {
    if (details[index] === undefined) {
      details[index] = {
        request: typeof row.content === 'string' ? extractAntigravityUserRequest(row.content) : undefined,
        count: 0,
        tools: new Set(),
        pending: [],
        failures: [],
      };
      return;
    }
    observeToolStep(details[index], row);
  });
  turnDetails.set(session, details);
  return session;
}

export function replyForStop(text, { turnStep, lastUserInput } = {}) {
  const session = parse(text);
  const turn = turnStep === undefined ? session.turns.at(-1) : session.turns.find(item => item.id === String(turnStep));
  if (turn?.status !== 'completed') return undefined;
  if (typeof lastUserInput === 'string' && lastUserInput.trim()) {
    const request = turnDetails.get(session)[turn.index - 1].request;
    if (request !== extractAntigravityUserRequest(lastUserInput)) return undefined;
  }
  return turn.reply ?? undefined;
}

function firstParagraph(value) {
  return value?.trim().split(/\r?\n[ \t]*\r?\n/, 1)[0].replace(/\s+/g, ' ');
}

function clip(text, limit) {
  if (Buffer.byteLength(text) <= limit) return text;
  let size = Buffer.byteLength('…');
  let prefix = '';
  for (const character of text) {
    size += Buffer.byteLength(character);
    if (size > limit) break;
    prefix += character;
  }
  return `${prefix}…`;
}

export function turnSummary(session, n) {
  if (!Number.isSafeInteger(n) || n < 1) return '找不到该轮。';
  const turn = session.turns[n - 1];
  if (!turn) return '找不到该轮。';
  const detail = turnDetails.get(session)?.[n - 1];
  const failures = detail?.failures.map(({ command, code }) =>
    `${code} ${command?.replace(/\s+/g, ' ') ?? '命令未知'}`).join('、');
  const request = clip(firstParagraph(detail?.request) ?? '未知', 86);
  const outcome = { completed: '完成', interrupted: '中断', incomplete: '未完成' }[turn.status] ?? '未知';
  const reply = clip(firstParagraph(turn.reply) || '无', 108);
  const tools = detail?.tools.size ? ` ${clip([...detail.tools].join('、'), 36)}` : '';
  // Bound UTF-8 bytes conservatively without introducing a tokenizer dependency.
  return `任务（${outcome}） ${request}\n工具调用 ${detail?.count ?? '未知'}${tools}\n非零退出 ${clip(failures || (detail ? '无已知' : '未知'), 90)}\n回复 ${reply}`;
}
