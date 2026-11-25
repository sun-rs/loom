import { messageIdPattern } from '../inbox/message.mjs';

// Orca b7fd7caa3, shared/agent-launch/startup/agent-resume-argv.ts.
// Pin a native session ID; an implicit "last session" or a picker can select a different worker.
export function agentResumeArgs(provider, id) {
  if (!messageIdPattern.test(id)) throw new TypeError('Resume requires a native session UUID');
  switch (provider) {
    case 'claude': return ['--resume', id];
    case 'codex': return ['resume', id];
    case 'agy': return ['--conversation', id];
    default: throw new RangeError(`Unsupported TUI resume: ${provider}`);
  }
}
