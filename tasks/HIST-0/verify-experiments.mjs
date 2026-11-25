import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openIndex } from '../../index/index.mjs';

const root = '/Users/sun/Code/exp-relay';
const runs = ['20261124151218-59651', '20261124165640-99591'];
const loom = fileURLToPath(new URL('../../bin/loom', import.meta.url));
const text = (value = '') => value.trim().replace(/\s+/g, ' ');
const paragraph = reply => reply?.trim().split(/\r?\n[^\S\r\n]*\r?\n/, 1)[0] ?? '';

function scopedFile(entry) {
  const { arm, cwd, path, provider, session_id: id } = entry;
  assert.ok(['h0', 'h1', 'orca'].includes(arm));
  assert.equal(cwd, join(root, arm));
  assert.match(id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
  if (provider === 'codex') {
    assert.match(dirname(path), /^\/Users\/sun\/\.codex\/sessions\/2026\/11\/(24|25)$/);
    assert.ok(basename(path).startsWith('rollout-') && basename(path).endsWith(`-${id}.jsonl`));
  } else if (provider === 'agy') {
    assert.equal(path, `/Users/sun/.gemini/antigravity-cli/brain/${id}/.system_generated/logs/transcript_full.jsonl`);
  } else {
    assert.equal(provider, 'claude');
    assert.equal(path, `/Users/sun/.claude/projects/${cwd.replace(/[^a-z0-9]/gi, '-')}/${id}.jsonl`);
  }
  assert.equal(realpathSync(path), path);
  return path;
}

// Check native turn markers, tool identities and final-message content independently of hist.
function codexTurns(records, entry) {
  const meta = records.find(row => row.type === 'session_meta')?.payload;
  assert.ok(meta?.cwd === entry.cwd && meta.id === entry.session_id, 'Unexpected Codex session provenance');
  const turns = [];
  let turn;
  for (const { type, payload } of records) {
    if (type === 'event_msg' && payload.type === 'task_started') turn = { ids: new Set(), failures: [] };
    if (!turn) continue;
    if (type === 'response_item' && payload.type === 'custom_tool_call') turn.ids.add(payload.call_id);
    if (type === 'event_msg' && payload.type === 'item_completed' && payload.item.type === 'CommandExecution') {
      const item = payload.item;
      turn.ids.add(item.call_id ?? item.id);
      const code = item.exit_code ?? item.exitCode;
      if (Number.isInteger(code) && code !== 0) turn.failures.push(code);
    }
    if (type === 'event_msg' && payload.type === 'task_complete') {
      turns.push({ tools: turn.ids.size, failures: turn.failures, reply: payload.last_agent_message });
      turn = undefined;
    }
  }
  return turns;
}

function agyTurns(records) {
  const turns = [];
  let turn;
  const steps = [...new Map(records.map(row => [row.step_index, row])).values()];
  for (const row of steps) {
    if (row.source === 'USER_EXPLICIT' && row.type === 'USER_INPUT') {
      turn = { tools: 0, failures: [], reply: null };
      turns.push(turn);
    }
    if (!turn || row.source !== 'MODEL') continue;
    if (row.type === 'PLANNER_RESPONSE') {
      const count = row.tool_calls?.length ?? 0;
      turn.tools += count;
      turn.reply = count > 0 ? null : row.content?.trim() || null;
    } else if (row.type === 'GENERIC') {
      const status = /^Command exited with code (-?\d+)\./m.exec(row.content?.split(/\r?\nCommand output:/i, 1)[0] ?? '');
      if (status && Number(status[1])) turn.failures.push(Number(status[1]));
    }
  }
  return turns;
}

function claudeTurns(records, entry) {
  const turns = [];
  let tools = new Set();
  let replyBlocks = new Map();
  for (const row of records) {
    if (row.isSidechain || row.parent_tool_use_id || row.parentToolUseId) continue;
    if (row.type === 'assistant') {
      assert.ok(row.cwd === entry.cwd && row.sessionId === entry.session_id, 'Unexpected Claude session provenance');
      const blocks = row.message.content;
      for (const [index, block] of blocks.entries()) {
        if (block.type === 'tool_use') {
          tools.add(block.id);
          replyBlocks.clear();
        } else if (block.type === 'text') {
          replyBlocks.set(`${row.message.id}/${row.apiBlockIndex ?? 0}/${index}`, block.text);
        }
      }
    }
    if (row.type === 'system' && row.subtype === 'turn_duration') {
      turns.push({ tools: tools.size, failures: [], reply: [...replyBlocks.values()].join('\n') });
      tools = new Set();
      replyBlocks = new Map();
    }
  }
  return turns;
}

function restoreRegistration(root, arm, archive, names) {
  const prefix = `${arm}/.project/`;
  for (const name of names) {
    if (!name.startsWith(prefix) || !/^(?:workers\.md|relay\/events\/[A-Za-z0-9][A-Za-z0-9_.-]*\.jsonl)$/.test(name.slice(prefix.length))) continue;
    const file = join(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, execFileSync('tar', ['-xOzf', archive, name]), { mode: 0o600 });
  }
  return join(root, arm);
}

function checkLevel1(native, turns) {
  const discrepancies = [];
  if (turns.length !== native.length) discrepancies.push('turns');
  for (const [index, original] of native.entries()) {
    const summary = turns[index]?.summary;
    if (!summary) continue;
    const observedTools = /工具(?:调用)? (\d+)/.exec(summary)?.[1];
    if (Number(observedTools) !== original.tools) discrepancies.push(`${index + 1}:tools(${observedTools ?? '?'}/${original.tools})`);
    const reply = /(?:^|\n)回复 ([\s\S]*)$/.exec(summary)?.[1];
    const expected = text(paragraph(original.reply));
    if (expected && (!reply || !expected.startsWith(text(reply.replace(/…$/, ''))))) discrepancies.push(`${index + 1}:reply`);
    if (!expected && reply && !['—', '无'].includes(reply.trim())) discrepancies.push(`${index + 1}:reply`);
    const failed = /(?:^|\n)非零退出 ([^\n]+)/.exec(summary)?.[1] ?? '';
    const firstCode = /^[[(]?(-?\d+)(?:\]|\)|\s|$)/.exec(failed.replace(/^\d+ 条\s*/, ''))?.[1];
    if (original.failures.length && Number(firstCode) !== original.failures[0]) discrepancies.push(`${index + 1}:exit`);
  }
  return discrepancies;
}

const testRoot = join(root, 'hist-0');
mkdirSync(testRoot, { recursive: true, mode: 0o700 });
const scratch = mkdtempSync(join(testRoot, 'sessions.'));
const path = join(scratch, 'index.sqlite');
const index = openIndex(path);
const failures = [];
let visited = 0;
let totalTurns = 0;
let maxBytes = 0;
try {
  for (const [round, run] of runs.entries()) {
    const runDir = join(root, 'runs', run);
    const manifest = JSON.parse(readFileSync(join(runDir, 'sessions.json'), 'utf8'));
    assert.equal(manifest.run_id, run);
    const archive = join(runDir, 'arms-final.tgz');
    const names = round === 0 ? execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split('\n') : [];
    for (const arm of ['h0', 'h1']) {
      const dir = round === 0 ? restoreRegistration(scratch, arm, archive, names) : join(root, arm);
      const imported = await index.importRelay(dir, { project: `${run}/${arm}` });
      console.log(`${run} ${arm} relay=${imported.length}`);
    }
    for (const entry of manifest.sessions) {
      const { arm, cwd, provider: cli, role, session_id: sessionId } = entry;
      const project = `${run}/${arm}`;
      const addr = entry.worker ?? entry.terminal;
      const transcriptPath = scopedFile(entry);
      const backend = arm === 'orca' && role === 'worker' ? 'headless' : 'tui';
      const row = { role, project, task: entry.task ?? null, backend, cli, sessionId, transcriptPath, cwd };
      const imported = index.query({ addr })[0];
      if (imported) {
        assert.equal(imported.project, project);
        assert.equal(imported.cli, cli);
        assert.ok(!imported.sessionId || imported.sessionId === sessionId, `Relay session mismatch at ${addr}`);
        index.update(addr, row);
      } else index.register({ addr, ...row });

      const records = readFileSync(transcriptPath, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
      const original = { codex: codexTurns, agy: agyTurns, claude: claudeTurns }[cli](records, entry);
      const result = JSON.parse(execFileSync(loom, ['hist', addr, '--turns', '1000', '--json'], {
        cwd: scratch, env: { ...process.env, LOOM_INDEX_PATH: path }, encoding: 'utf8',
      }));
      assert.ok(result.ok && result.addr === addr);
      const size = Math.max(0, ...result.turns.map(turn => Buffer.byteLength(turn.summary)));
      assert.ok(size <= 400, `L1 exceeds 400 bytes at ${addr}`);
      const gaps = checkLevel1(original, result.turns);
      const label = `${run} ${arm} ${entry.task ?? role} ${cli}`;
      if (gaps.length) failures.push(`${label} ${gaps.join(',')}`);
      console.log(`${label} turns=${result.turns.length}/${original.length} maxBytes=${size} discrepancies=${gaps.length}`);
      visited++;
      totalTurns += result.turns.length;
      maxBytes = Math.max(maxBytes, size);
    }
  }
  assert.equal(index.query().length, 42);
  console.log(`sessions=${visited} turns=${totalTurns} maxBytes=${maxBytes} mismatchedSessions=${failures.length}`);
  for (const gap of failures) console.log(gap);
  if (failures.length) process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
