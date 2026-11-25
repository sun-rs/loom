import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { history, historyReader } from '../../cli/history.mjs';

const samples = [
  'codex-h0-t1', 'codex-h1-t2', 'codex-orca-t2', 'agy-h0-t3', 'agy-h1-t4', 'agy-orca-t4',
  'claude-runtime-probe', 'claude-runtime-final', 'claude-loom-cli', 'oar-headless-codex',
];
const extract = (text, language) => [...text.matchAll(new RegExp('^~~~' + language + '\\n([\\s\\S]*?)\\n~~~$', 'gm'))]
  .map(match => match[1]);
const code = value => /^-?\d+$/.test(value ?? '') ? Number(value) : null;

function turnsOf(doc, name) {
  const [, provider] = /Native ID `[^`]+` · (\w+)/.exec(doc);
  const [, locator] = /Transcript `([^`]+)`/.exec(doc);
  const [, oldBytes] = /\| L1 with fact rows \| (\d+)/.exec(doc);
  const [, oldDigest] = /\| Activity digest \| (\d+)/.exec(doc);
  const a = doc.split('## A. Native final replies')[1].split('## B. Loom hist L1')[0];
  const b = doc.split('## B. Loom hist L1')[1].split('## C. Filtered L2')[0];
  const [oldL1, digest] = extract(b, 'text');
  const detailed = JSON.parse(extract(doc.split('## C. Filtered L2')[1], 'json')[0]);
  const basePrompts = [...oldL1.matchAll(/^任务(?:（[^）]+）)? (.+)$/gm)].map(match => match[1]);
  const turns = digest.split(/\n\n(?=Turn \d+ ·)/).map((turn, i) => {
    const status = /^Turn \d+ · (\w+)/.exec(turn)[1];
    const test = turn.split(/^Tests(?: —)?$/m)[1] ?? '';
    const outputs = [...test.matchAll(/^  (\d+|\?) total, (\d+|\?) pass, (\d+|\?) fail, (\d+|\?) skip · (.+)$/gm)]
      .map(([, total, pass, fail, skip, cmd]) => ({ total, pass, fail, skip, cmd }));
    const commands = [...turn.matchAll(/^  \[exit (\d+|\?)\] (.+)$/gm)].map(([, exit, command]) => {
      const countsIndex = outputs.findIndex(output => output.cmd === command);
      const counts = countsIndex < 0 ? null : outputs.splice(countsIndex, 1)[0];
      const detail = detailed.index === i + 1 && detailed.tools.find(tool => tool.command === command && tool.exitCode === code(exit));
      const summary = counts ? [['tests', counts.total], ['pass', counts.pass], ['fail', counts.fail], ['skipped', counts.skip]]
        .filter(([, number]) => number !== '?').map(([label, number]) => `ℹ ${label} ${number}`).join('\n') : '';
      return { command, exit: code(exit), output: [detail?.output, summary].filter(Boolean).join('\n'), test: counts !== null };
    });
    const reply = a.split(new RegExp('#### Turn ' + (i + 1) + '\\b'))[1].split(/\n#### Turn /)[0];
    const basePrompt = detailed.index === i + 1 ? detailed.prompts?.[0] ?? basePrompts[i] : basePrompts[i];
    const prompt = name === 'claude-loom-cli' && i > 0 ? i === 1 ?
      '<pasted_content id="fixture">[loom:sample] 波次 W-SMOKE</pasted_content>' :
      '<hc from="fixture">[loom:sample] 核对波次和证据卡</hc>' : basePrompt;
    const queued = name === 'claude-runtime-probe' && i === 1 ? 2 : Number(name === 'claude-runtime-final' && i === 4);
    return { status, commands, reply: extract(reply, 'text')[0] ?? null, prompt, queued,
      start: detailed.index === i + 1 ? detailed.startedAt : null,
      end: detailed.index === i + 1 ? detailed.endedAt : null };
  });
  return { turns, provider, locator, oldBytes: Number(oldBytes), oldDigest: Number(oldDigest) };
}

function encode(sample, name) {
  const rows = [];
  for (const [index, turn] of sample.turns.entries()) {
    const id = 'turn-' + (index + 1);
    const rowAt = (n, limit) => turn.start && turn.end ? new Date(
      Date.parse(turn.start) + Math.round((Date.parse(turn.end) - Date.parse(turn.start)) * n / limit)).toISOString() : undefined;
    const limit = 5 + 4 * turn.commands.length;
    let indexInTurn = 0;
    if (sample.provider === 'codex') {
      const event = payload => rows.push({ type: 'event_msg', timestamp: rowAt(indexInTurn++, limit),
        payload: { turn_id: id, ...payload } });
      event({ type: 'task_started' });
      event({ type: 'user_message', message: turn.prompt });
      const response = payload => rows.push({ type: 'response_item', timestamp: rowAt(indexInTurn++, limit), payload });
      for (const [i, { command, exit, output }] of turn.commands.entries()) {
        const call_id = id + ':' + i;
        if (name === 'oar-headless-codex') {
          response({ type: 'custom_tool_call', name: 'exec', call_id: 'wrapper',
            input: 'text(await tools.exec_command({cmd:"node --test smoke.test.mjs"}))' });
        }
        event({ type: 'exec_command_begin', call_id, command });
        event({ type: 'exec_command_end', call_id, exit_code: exit, aggregated_output: output ||
          (name === 'codex-h0-t1' && command.includes('SPEC.md') ? 'rate-limit is a screen state' : '') });
        if (name === 'oar-headless-codex') {
          response({ type: 'custom_tool_call_output', call_id: 'wrapper',
            output: 'Script completed\nOutput:\n' + JSON.stringify({ exit_code: exit, output }) });
        }
      }
      indexInTurn = limit;
      event({ type: 'task_complete', last_agent_message: turn.reply });
    } else if (sample.provider === 'agy') {
      const row = (type, fields, source = 'MODEL') => rows.push({ type, source, step_index: rows.length,
        created_at: rowAt(indexInTurn++, limit), ...fields });
      row('REQUEST', { content: turn.prompt }, 'USER');
      for (const [i, { command, exit, output }] of turn.commands.entries()) {
        if (name === 'agy-h1-t4' && i === 3) {
          row('PLANNER_RESPONSE', { tool_calls: [{ name: 'mcp_agy-fast_fast_apply_edits' }] });
          row('GENERIC', { content: 'Verify [FAIL (exit 1) in 80ms] `' + command + '`:\n' + output });
          continue;
        }
        row('PLANNER_RESPONSE', { tool_calls: [{ name: 'run_command', args: { CommandLine: command } }] });
        row('GENERIC', { content: `Command exited with code ${exit}.\n\nCommand output:\n${output}` });
      }
      indexInTurn = limit;
      row('PLANNER_RESPONSE', { status: 'DONE', content: turn.reply });
    } else {
      const row = (type, extra) => rows.push({ type, timestamp: rowAt(indexInTurn++, limit), ...extra });
      row('user', { uuid: id, message: { content: turn.prompt ?? 'Continue' } });
      for (const [i, { command, exit, output }] of turn.commands.entries()) {
        const id = 'bash-' + index + ':' + i;
        row('assistant', { message: { id, stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
        row('user', { message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: exit !== 0, content: output || 'ok' }] } });
      }
      for (let i = 0; i < turn.queued; i++) row('attachment',
        { attachment: { type: 'queued_command', commandMode: 'prompt', prompt: 'Queued sample input' } });
      indexInTurn = limit;
      if (turn.status === 'interrupted') row('user', { message: { content: '[Request interrupted by user]' } });
      else row('assistant', { message: { id: id + ':reply', stop_reason: 'end_turn', content: [{ type: 'text', text: turn.reply }] } });
    }
  }
  return rows.map(row => JSON.stringify(row)).join('\n') + '\n';
}

const cwd = mkdtempSync(join(realpathSync(tmpdir()), 'loom-fix-2b-pack-'));
try {
  const results = [];
  for (const name of samples) {
    const doc = readFileSync(new URL(`../L1-EVAL-0/${name}.md`, import.meta.url), 'utf8');
    const sample = turnsOf(doc, name);
    const transcriptPath = join(cwd, sample.locator.split('/').at(-1).replace(/^transcript_full(?=\.jsonl$)/, name));
    writeFileSync(transcriptPath, encode(sample, name));
    const session = { cli: sample.provider, addr: name, cwd, project: cwd, transcriptPath, endedAt: null };
    const reader = historyReader(cwd);
    const options = { tail: 10, count: Infinity };
    const { turns: summaries } = await history([session], reader, { ...options, level: 'L1' });
    const { turns: details } = await history([session], reader, { ...options, level: 'L2' });
    const tests = details.flatMap(turn => turn.tests);
    const expected = sample.turns.flatMap(turn => turn.commands).filter(command => command.test).length;
    if (summaries.length !== sample.turns.length || expected !== tests.length) throw new Error(`Replay coverage regressed for ${name}`);
    const exact = tests.filter(test => test.countStatus === 'recognised').length;
    const oldL1 = sample.oldBytes;
    const newL1 = Buffer.byteLength([`${name} L1`, ...summaries.map(turn => '\n' + turn.summary)].join('\n'));
    const max = Math.max(...summaries.map(turn => Buffer.byteLength(turn.summary)));
    results.push({ name, oldL1, oldDigest: sample.oldDigest, newL1, max, expected, exact,
      unknown: tests.length - exact, statuses: summaries.map(turn => turn.status), output: summaries.map(turn => turn.summary) });
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 2));
  else {
    console.log('| 样本 | 旧 L1 字节 | 旧 digest 字节 | 新 L1 字节 | 单轮最大字节 | 测试计数 / 未识别 |');
    console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const row of results) console.log(`| ${row.name} | ${row.oldL1} | ${row.oldDigest} | ${row.newL1} | ${row.max} | ${row.exact} / ${row.unknown} |`);
  }
} finally { rmSync(cwd, { recursive: true, force: true }); }
