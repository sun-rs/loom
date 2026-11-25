import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { generateBrief } from './brief.mjs';
import { roles } from './transcript.mjs';

const run = promisify(execFile);
const loom = fileURLToPath(new URL('../bin/loom', import.meta.url));
const address = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const usage = 'loom handover <leader|auditor|super> --project P [--to <新地址>]';

async function projectRoot(project) {
  if (isAbsolute(project) || project === '.' || project.startsWith('./') || project.startsWith('../')) return resolve(project);
  if (process.env.LOOM_PROJECT) return resolve(process.env.LOOM_PROJECT);
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if ((await stat(join(dir, '.project')).catch(() => null))?.isDirectory()) return dir;
    if (dirname(dir) === dir) return process.cwd();
  }
}

export async function queueBrief({ projectDir, to, brief }) {
  let response;
  try {
    const { stdout } = await run(process.execPath, [loom, 'send', to, '--mode', 'queue', '--project', projectDir, '--', brief],
      { cwd: projectDir, timeout: 15_000 });
    response = JSON.parse(stdout);
  } catch (error) {
    // An uncertain handoff must not be retried as another delivery.
    try { response = JSON.parse(error.stdout); } catch { /* no durable receipt was returned */ }
  }
  if (response?.ok === false) throw Object.assign(new Error(response.error?.message), { code: response.error?.code });
  if (response?.mode !== 'queue' || !(response.id ?? response.deliveryId)) throw new Error('收件箱队列回执不可用');
  return response;
}

export async function main(args, options = {}) {
  const emit = options.emit ?? (value => console.log(JSON.stringify(value)));
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    (options.help ?? console.log)(usage);
    return 0;
  }
  let parsed;
  try {
    parsed = parseArgs({ args, options: { project: { type: 'string' }, to: { type: 'string' } }, allowPositionals: true });
    if (parsed.positionals.length !== 1 || !roles.includes(parsed.positionals[0]) || !parsed.values.project?.trim() ||
        (parsed.values.to !== undefined && !address.test(parsed.values.to))) throw new Error(usage);
  } catch (error) {
    emit({ ok: false, error: { code: 'invalid-arguments', message: error.message } });
    return 2;
  }
  const [role] = parsed.positionals;
  const { project: requested, to } = parsed.values;
  const projectDir = options.projectDir ?? (options.projectDirectory ?? projectRoot)(requested);
  const directory = await projectDir;
  const resolved = options.indexFor?.(requested, directory);
  const project = resolved?.project ?? requested;
  const result = await generateBrief({ role, project, projectDir: directory, to, index: resolved?.index ?? options.index, locate: options.locate });
  const output = { role, project, ...result };
  if (!to) { emit({ ok: true, ...output }); return 0; }
  try {
    const delivery = await (options.queue ?? queueBrief)({ project, projectDir: directory, from: result.addr,
      to, mode: 'queue', brief: result.brief });
    emit({ ok: true, ...output, to, delivery });
    return 0;
  } catch (error) {
    const code = error.code ?? 'unavailable';
    emit({ ok: false, ...output, to, error: { code, message: error.message } });
    return ['not-found', 'ambiguous-target'].includes(code) ? 3 : 1;
  }
}
