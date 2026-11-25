import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const base = '/Users/sun/Code/exp-relay';
const bench = join(base, 'mode-bench');
const [cli, mode, n] = process.argv.slice(2);
if (!['codex', 'agy'].includes(cli) || !['tui', 'headless'].includes(mode) || !['1', '2'].includes(n)) {
  throw new Error('Usage: node bench.mjs <codex|agy> <tui|headless> <1|2>');
}
const task = cli === 'codex' ? 'T1' : 'T3';
const model = cli === 'codex' ? 'gpt-6.2-sol' : 'gemini-4-neon';
const effort = cli === 'codex' ? 'high' : 'xhigh';
const name = `${cli}-${mode}-${n}`;
const cwd = join(bench, name);
const output = join(bench, '_control', name);
const save = (file, data) => writeFileSync(join(output, file), JSON.stringify(data, null, 2) + '\n');

mkdirSync(cwd);
cpSync(join(base, 'seed'), cwd, { recursive: true });
mkdirSync(output, { recursive: true });
const spec = readFileSync(join(cwd, 'SPEC.md'), 'utf8');
const shared = spec.slice(spec.indexOf('## 会话返回结构'), spec.indexOf('## T1 '));
const own = spec.slice(spec.indexOf(`## ${task} `), spec.indexOf(`## T${Number(task[1]) + 1} `));
const prompt = [
  '在当前 seed 副本中完成下面的任务。只在当前目录读写任务文件和公开样本。不读取其他会话、凭据、.env 或隐藏验收，不修改全局配置，不提交。使用 Node.js 标准库、ESM 和 node:test，运行 node --test 验证。',
  shared.trimEnd(),
  own.trimEnd(),
  '完成后最终回复首行 DONE T1',
].join('\n\n');
writeFileSync(join(output, 'prompt.txt'), prompt);
const startedAt = Date.now();
save('run.json', { cli, mode, n, task, model, effort, cwd, startedAt });

if (mode === 'tui') {
  const hooks = execFileSync(process.execPath, [join(repo, 'relay/hooks.mjs'), 'setup', cli, cwd], { encoding: 'utf8' }).trim();
  const nativeArgs = cli === 'codex' ? [
    '--no-daemon', '--dangerously-bypass-hook-trust', '--disable', 'memories', '-c', hooks,
    '-c', `projects.${JSON.stringify(cwd)}.trust_level="trusted"`, '-m', model,
    '-c', `model_reasoning_effort="${effort}"`, '-a', 'never', '-s', 'workspace-write', prompt,
  ] : [
    '--dangerously-skip-permissions', '--sandbox', '--settings', JSON.stringify({ trustedWorkspaces: [cwd] }),
    '--model', model, '--effort', effort, '--log-file', join(output, 'native.log'), '-i', prompt,
  ];
  const address = JSON.parse(execFileSync('hc', [
    'run', '--bg', '--json', '--no-parent', '--no-notify', '--outlive-parent',
    '--name', `oar-${name}`, '--cwd', cwd, '--', cli, ...nativeArgs,
  ], { encoding: 'utf8' })).address;
  if (!/^t[0-9a-z]+$/.test(address)) throw new Error('Launch returned no local terminal address');
  save('terminal.json', { address, cwd });
  console.log(name, address);
} else {
  const { spawnHeadless } = await import('../../runtimes/oar/index.mjs');
  const worker = await spawnHeadless({ cli, model, effort, cwd, prompt, project: bench, task, wave: name }, {
    firstTurnOptions: { timeoutMs: 900_000 },
  });
  try {
    const run = await worker.firstTurn;
    save('outcome.json', { kind: run.kind, outcome: run.outcome, code: run.code, effort: worker.effort });
    console.log(name, worker.index.sessionId, run.outcome?.kind ?? run.kind);
  } finally {
    await worker.close();
    save('session.json', worker.index);
  }
}
