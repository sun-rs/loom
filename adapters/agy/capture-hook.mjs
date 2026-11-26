import { acceptsAgyHook } from './hook-binding.mjs';
import { closeSync, constants, fstatSync, openSync, readFileSync, writeSync } from 'node:fs';
import { getAntigravityNoOpStdout, normalize } from './hooks.mjs';
import { locateHookTranscript, replyForStop } from './transcript.mjs';
import { deliveryId } from '../../inbox/message.mjs';

const [sink, cwd, hookEventName, binding = sink + '.agy-session', sessionId] = process.argv.slice(2);
const openFlags = constants.O_NOFOLLOW | constants.O_NONBLOCK;

function readRegularFile(path) {
  const fd = openSync(path, constants.O_RDONLY | openFlags);
  try {
    if (fstatSync(fd).isFile()) return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

function captureReply(event, payload) {
  if (event.finalReply) return event.finalReply;
  try {
    const path = locateHookTranscript({ ...event, cwd });
    if (!path) return;
    const rows = readRegularFile(sink)?.trimEnd().split('\n') ?? [];
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const start = JSON.parse(rows[index]);
      if (start.conversationId !== event.sessionId) continue;
      if (start.hookEventName === 'Stop' && start.fullyIdle !== false) return;
      if (start.hookEventName !== 'PreInvocation') continue;
      // The first invocation counts the user step in initialNumSteps. Match that step so
      // a Stop that beats the transcript flush cannot publish a previous turn's reply.
      if (!Number.isSafeInteger(start.initialNumSteps) || start.initialNumSteps < 1) return;
      return replyForStop(readRegularFile(path), {
        turnStep: start.initialNumSteps - 1,
        lastUserInput: payload.lastUserInput,
      });
    }
  } catch {
    // A Stop remains useful if the native transcript is missing, incomplete, or still flushing.
  }
}

function capture() {
  const receivedAt = Date.now();
  const payload = JSON.parse(readFileSync(0, 'utf8'));
  if (!payload || typeof payload !== 'object') return;
  const event = normalize({ ...payload, hookEventName });
  if (!event?.sessionId || !acceptsAgyHook(payload, event, cwd, binding, sessionId, hookEventName)) return;

  // Follow relay/hooks.mjs's per-worker append-only sink and keep the native correlation fields.
  const fields = ['invocationNum', 'initialNumSteps', 'executionNum', 'terminationReason', 'fullyIdle', 'stepIdx', 'modelName'];
  const row = {
    hookEventName,
    hook_event_name: hookEventName,
    receivedAt,
    cwd: typeof payload.cwd === 'string' ? payload.cwd : cwd,
    ...(Array.isArray(payload.workspacePaths) && payload.workspacePaths.includes(cwd) && { workspacePaths: [cwd] }),
    conversationId: event.sessionId,
    transcriptPath: event.transcriptPath,
    deliveryId: deliveryId(payload.lastUserInput ?? payload.last_user_input),
  };
  for (const field of fields) {
    const snake = field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    const value = payload[field] ?? payload[snake];
    if (['string', 'number', 'boolean'].includes(typeof value)) row[field] = value;
  }
  if (payload.error) row.error = true;
  const toolName = (payload.toolCall ?? payload.tool_call)?.name;
  if (typeof toolName === 'string') row.toolName = toolName;
  if (event.type === 'turn-end') {
    const reply = captureReply(event, payload);
    if (reply !== undefined) row.finalReply = reply;
  }

  const line = Buffer.from(`${JSON.stringify(row)}\n`);
  const fd = openSync(sink, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | openFlags, 0o600);
  try {
    if (!fstatSync(fd).isFile()) return;
    if (writeSync(fd, line) !== line.length) throw new Error('Incomplete agy hook append');
  } finally {
    closeSync(fd);
  }
}

try {
  capture();
} catch {
  // Observing a hook does not change the CLI's decisions.
} finally {
  const reply = getAntigravityNoOpStdout(hookEventName);
  if (reply !== undefined) process.stdout.write(reply);
}
