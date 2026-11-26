import { acceptsAgyHook } from '../adapters/agy/hook-binding.mjs';
import { appendFileSync, constants, readFileSync } from 'node:fs';
import { agyPrompt, agyQuestionDenial, getAntigravityNoOpStdout, normalize } from '../adapters/agy/hooks.mjs';
import { deliveryId } from '../inbox/message.mjs';

// A scoped PTY host can use native activity without resolving a transcript path.
const [sink, cwd, hookEventName, binding = sink + '.agy-session', sessionId, questionPolicy] = process.argv.slice(2);
let questionDenial;
try {
  const receivedAt = Date.now();
  const { transcriptPath, transcript_path, transcriptText, ...payload } = JSON.parse(readFileSync(0, 'utf8'));
  const event = normalize({ ...payload, hookEventName });
  if (event?.sessionId && acceptsAgyHook(payload, event, cwd, binding, sessionId, hookEventName)) {
    questionDenial = agyQuestionDenial(payload, hookEventName, questionPolicy);
    const row = {
      hookEventName, hook_event_name: hookEventName, receivedAt, cwd: typeof payload.cwd === 'string' ? payload.cwd : cwd, conversationId: event.sessionId,
      ...(Array.isArray(payload.workspacePaths) && payload.workspacePaths.includes(cwd) && { workspacePaths: [cwd] }),
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
    const promptState = !questionDenial && agyPrompt(payload, hookEventName);
    if (questionDenial) row.questionDenied = true;
    if (promptState) row.promptState = promptState;
    appendFileSync(sink, `${JSON.stringify(row)}\n`, {
      flag: constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      mode: 0o600, flush: true,
    });
  }
} catch {
  // Observation does not influence the provider's turn.
} finally {
  const reply = questionDenial ?? getAntigravityNoOpStdout(hookEventName);
  if (reply !== undefined) process.stdout.write(reply);
}
