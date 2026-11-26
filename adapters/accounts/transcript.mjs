import { lstat } from 'node:fs/promises';
import { jsonlTail } from '../../runtimes/tui/read-jsonl.mjs';
import { accountTime, parseClaudeTranscriptLine, parseCodexRolloutLine } from './passive.mjs';

export function accountTranscript(cli, sessionId) {
  let read = jsonlTail();
  let sequence = 0;
  let identity;
  let size = 0;
  let codexMeta;
  let claudeVersion;
  return async (transcript, binding) => {
    const stat = await lstat(transcript);
    const current = `${transcript}:${stat.dev}:${stat.ino}`;
    if (identity !== current || stat.size < size) {
      identity = current;
      claudeVersion = undefined;
      read = jsonlTail();
      codexMeta = undefined;
      sequence = 0;
    }
    size = stat.size;
    const observations = [];
    for (const row of await read(transcript)) {
      sequence++;
      if (cli === 'codex' && row.type === 'session_meta') {
        codexMeta = row.payload?.id === sessionId && (!row.payload.cwd || row.payload.cwd === binding.cwd) ?
          { cliVersion: row.payload.cli_version } : null;
        continue;
      }
      const observedAt = accountTime(row.timestamp ?? row.created_at);
      if (!observedAt || Date.parse(observedAt) < binding.startedAt ||
          (row.sessionId ?? row.session_id) && (row.sessionId ?? row.session_id) !== sessionId) continue;
      const ctx = { ...binding, sessionId, sequence, isReplay: true };
      if (cli === 'codex' && codexMeta) {
        observations.push(...parseCodexRolloutLine(row, { ...ctx, cliVersion: binding.cliVersion ?? codexMeta.cliVersion }));
      } else if (cli === 'claude' && (row.sessionId ?? row.session_id) === sessionId &&
          !row.isSidechain && !row.agent_id && !row.agentId && !row.parent_tool_use_id && !row.parentToolUseId) {
        if (typeof row.version === 'string') claudeVersion = row.version;
        observations.push(...parseClaudeTranscriptLine(row, { ...ctx, cliVersion: binding.cliVersion ?? claudeVersion }));
      }
    }
    return observations;
  };
}
