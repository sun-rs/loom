import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { request } from '../daemon/rpc.mjs';
import { projectDirectory } from './project.mjs';
import { CommandError } from './sessions.mjs';

export const seniorToolUsage = 'loom senior-tool [--project DIR] [--reason REASON] -- "command"';
const tailLines = 40;
const tailBytes = 12_000;

export async function runSeniorTool(args) {
  const separator = args.indexOf('--');
  if (separator < 0 || args.length !== separator + 2 || !args.at(-1)?.trim()) {
    throw new CommandError('invalid-arguments', seniorToolUsage);
  }
  const { values } = parseArgs({ args: args.slice(0, separator), options: { project: { type: 'string' }, reason: { type: 'string' } } });
  const project = projectDirectory(values.project);
  const command = args.at(-1);
  const reason = values.reason ?? process.env.LOOM_SENIOR_OVERRIDE;
  const authorized = await request(project, 'senior-override', { command, reason });
  const child = spawn('/bin/sh', ['-c', command], { cwd: authorized.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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
