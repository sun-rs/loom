import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { denialIdPattern } from '../lib/senior-command.mjs';
import { request } from '../daemon/rpc.mjs';
import { projectDirectory } from './project.mjs';
import { CommandError } from './sessions.mjs';

export const seniorToolUsage = [
  'loom senior-tool --retry DENY-ID --file PATH --lines START-END --reason REASON [--project DIR]',
  'loom senior-tool --file PATH --lines START-END [--project DIR] [--reason REASON] -- "command"',
].join('\n');
const tailLines = 40;
const tailBytes = 12_000;

export async function runSeniorTool(args) {
  const separator = args.indexOf('--');
  let values;
  try {
    ({ values } = parseArgs({ args: separator < 0 ? args : args.slice(0, separator),
      options: {
        project: { type: 'string' }, reason: { type: 'string' }, retry: { type: 'string' },
        file: { type: 'string', multiple: true }, lines: { type: 'string', multiple: true },
      } }));
  } catch (error) {
    throw new CommandError('invalid-arguments', error.message);
  }
  const command = separator < 0 ? undefined : args[separator + 1];
  const retryId = values.retry;
  const file = values.file?.length === 1 ? values.file[0] : undefined;
  const lineRange = values.lines?.length === 1 ? values.lines[0] : undefined;
  if (!file?.trim() || !lineRange?.trim() || (retryId !== undefined ? separator >= 0 || !denialIdPattern.test(retryId) :
      separator < 0 || args.length !== separator + 2 || !command?.trim())) {
    throw new CommandError('invalid-arguments', seniorToolUsage);
  }
  const project = projectDirectory(values.project);
  const reason = values.reason ?? process.env.LOOM_SENIOR_OVERRIDE;
  const authorized = await request(project, 'senior-override', { command, retryId, reason, file, lines: lineRange });
  const child = spawn('/bin/sh', ['-c', authorized.command ?? command], { cwd: authorized.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let tail = Buffer.alloc(0);
  let clipped = false;
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    const combined = Buffer.concat([tail, chunk.subarray(-tailBytes)]);
    clipped ||= chunk.length > tailBytes || combined.length > tailBytes;
    tail = combined.subarray(-tailBytes);
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => resolve(code ?? 1));
  });
  const lines = tail.toString('utf8').trimEnd().split(/\r?\n/);
  if (clipped || lines.length > tailLines) console.log(`Loom retained the final ${tailLines} lines (up to ${tailBytes} bytes).`);
  if (tail.length) console.log(lines.slice(-tailLines).join('\n'));
  return code;
}
