import { appendFileSync, constants } from 'node:fs';
import { approval, choice, promptDetails } from '../../prompt-state.mjs';
import { hostToolDenial } from '../../../lib/host-tool-guard.mjs';
import { recordSeniorToolDenial, rotationToolDenial, seniorToolCategory } from '../../../lib/senior-tool-guard.mjs';

export default {
  id: 'loom-prompt-events',
  async setup(ctx) {
    const sink = process.env.LOOM_OPENCODE_PROMPT_SINK;
    const sessionId = process.env.LOOM_OPENCODE_PROMPT_SESSION;
    const { LOOM_SENIOR_TOOL_LOG: guardLog, LOOM_SENIOR_TOOL_PROJECT: project } = process.env;
    if (process.env.LOOM_HOST_GUARD === '1' || guardLog && project) {
      const cwd = ctx.location.directory;
      await ctx.permission.hook('evaluate', event => {
        if (sessionId && event.sessionID !== sessionId) return;
        const input = event.metadata?.input;
        const inputs = event.action === 'shell' ? event.resources.map(command => ({ command })) : [{ paths: event.resources }];
        const restriction = (input ? [input] : inputs).map(value => hostToolDenial(event.action, value)).find(Boolean) ??
          (input ? [input, ...inputs] : inputs)
          .map(value => rotationToolDenial(guardLog, project, cwd, event.action, value)).find(Boolean);
        if (restriction) {
          Object.assign(event, { effect: 'deny', message: restriction });
          return;
        }
        if (!guardLog || !project) return;
        if (event.action === 'read' && input && !seniorToolCategory('read', input, cwd, project)) return;
        const reason = inputs.find(input => seniorToolCategory(event.action, input, cwd, project));
        if (reason) Object.assign(event, { effect: 'deny', message: recordSeniorToolDenial(guardLog, project, cwd, event.action, reason) });
      });
    }
    if (!sink || !sessionId) return;
    const controller = new AbortController();
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        const data = event.data;
        const form = data?.form;
        if ((data?.sessionID ?? form?.sessionID) !== sessionId) continue;
        let requestId;
        let promptState;
        if (event.type === 'permission.asked') {
          requestId = data.id;
          promptState = promptDetails(approval, data.action && `Allow ${data.action}?`, 3);
        } else if (event.type === 'form.created' && form.metadata?.kind === 'question') {
          const field = form.fields?.[0];
          requestId = form.id;
          promptState = promptDetails(choice, field?.description ?? field?.title, field?.options?.length);
        } else if (event.type === 'permission.replied') {
          requestId = data.requestID;
        } else if (/^form\.(?:replied|dismissed|cancelled|rejected)$/.test(event.type)) {
          requestId = data.id;
        }
        if (typeof requestId !== 'string') continue;
        appendFileSync(sink, JSON.stringify({
          receivedAt: Date.now(), session_id: sessionId, requestId,
          hook_event_name: promptState ? 'PromptOpened' : 'PromptClosed',
          ...(promptState && { promptState }),
        }) + '\n', {
          mode: 0o600, flag: constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        });
      }
    })().catch(() => { /* The visible TUI remains the fallback. */ });
    return () => controller.abort();
  },
};
