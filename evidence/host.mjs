import { jsonRows, readText } from '../daemon/io.mjs';
import { workerExecutableLog } from '../daemon/worker-executables.mjs';
import { turnTools } from '../lib/turn-tools.mjs';
import { forTurn } from './index.mjs';

export async function recordHostEvidence(project, row, grant, events) {
  const tools = events.filter(event => ['tool_call_started', 'tool_call_input', 'tool_call_ended'].includes(event.type));
  const turns = Map.groupBy(tools, event => JSON.stringify([event.streamId, event.turnId]));
  const commands = Array.from(turns.values()).flatMap(rows => turnTools(row.cli, {}, rows.map(row => ({ row })))
    .filter(tool => tool.tool === 'shell')
    .map(({ command, name, status, exitCode, timestamp }) => ({ command, name, status, exitCode, timestamp })));
  const executables = jsonRows(readText(workerExecutableLog(project, row.addr)));
  return forTurn({ project, cwd: null, task: row.task, turn: `host-${row.addr}`, provider: row.cli,
    addr: row.addr, endedAt: row.endedAt, gitObservation: { status: 'host-session-audit' },
    hostAudit: { grantId: grant.id, expiresAt: grant.expiresAt, commands, executables,
      coverage: 'Provider-event and hook coverage. Not fail-closed for Codex tool paths.' } });
}
