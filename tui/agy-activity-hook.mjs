import { appendFileSync, constants, readFileSync } from 'node:fs';
import { getAntigravityNoOpStdout, normalize } from '../adapters/agy/hooks.mjs';
import { deliveryId } from '../inbox/message.mjs';

// A scoped PTY host can use native activity without resolving a transcript path.
const [sink, cwd, hookEventName] = process.argv.slice(2);
try {
  const receivedAt = Date.now();
  const { transcriptPath, transcript_path, transcriptText, ...payload } = JSON.parse(readFileSync(0, 'utf8'));
  const event = Array.isArray(payload.workspacePaths) && payload.workspacePaths.includes(cwd) &&
    normalize({ ...payload, hookEventName });
  if (event?.sessionId) {
    const row = {
      hookEventName, hook_event_name: hookEventName, receivedAt, cwd, conversationId: event.sessionId,
      deliveryId: deliveryId(payload.lastUserInput ?? payload.last_user_input),
      finalReply: event.finalReply,
    };
    for (const field of ['invocationNum', 'initialNumSteps', 'executionNum', 'terminationReason', 'fullyIdle', 'stepIdx', 'modelName']) {
      const snake = field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      const value = payload[field] ?? payload[snake];
      if (['string', 'number', 'boolean'].includes(typeof value)) row[field] = value;
    }
    if (payload.error) row.error = true;
    const toolName = (payload.toolCall ?? payload.tool_call)?.name;
    if (typeof toolName === 'string') row.toolName = toolName;
    appendFileSync(sink, `${JSON.stringify(row)}\n`, {
      flag: constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      mode: 0o600, flush: true,
    });
  }
} catch {
  // Observation does not influence the provider's turn.
} finally {
  const reply = getAntigravityNoOpStdout(hookEventName);
  if (reply !== undefined) process.stdout.write(reply);
}
