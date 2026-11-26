import { writeFileSync } from 'node:fs';
import { readText } from '../../daemon/io.mjs';

export function acceptsAgyHook(payload, event, cwd, binding, sessionId, name) {
  if (payload.agent_id || payload.agentId || payload.isSidechain || payload.parentToolUseId || payload.parent_tool_use_id) return false;
  if (sessionId) return event.sessionId === sessionId;
  const current = readText(binding, null);
  if (current !== null) return current === event.sessionId;
  if (name !== 'PreInvocation' || !Array.isArray(payload.workspacePaths) || !payload.workspacePaths.includes(cwd)) return false;
  try {
    writeFileSync(binding, event.sessionId, { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return readText(binding) === event.sessionId;
  }
}
